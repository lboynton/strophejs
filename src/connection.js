/* jshint undef: true, unused: true:, noarg: true, latedef: true */
/*global setTimeout, clearTimeout,
    define */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['./base64', './core', './bosh', './build', './pres', './iq'], function(Base64, Strophe, Bosh, $build, $pres, $iq) {
            // But also create global
            return (root.Strophe.Connection = factory(Base64, Strophe, Bosh, $build, $pres, $iq));
        });
    } else {
        // Browser globals
        root.Strophe.Connection = factory(root.Base64, root.Strophe, root.Strophe.Bosh, root.$build, root.$pres, root.$iq);
    }
}(this, function (Base64, Strophe, Bosh, $build, $pres, $iq) {

    /** Class: Strophe.Connection
     *  XMPP Connection manager.
     *
     *  This class is the main part of Strophe.  It manages a BOSH connection
     *  to an XMPP server and dispatches events to the user callbacks as
     *  data arrives.  It supports SASL PLAIN, SASL DIGEST-MD5, SASL SCRAM-SHA1
     *  and legacy authentication.
     *
     *  After creating a Strophe.Connection object, the user will typically
     *  call connect() with a user supplied callback to handle connection level
     *  events like authentication failure, disconnection, or connection
     *  complete.
     *
     *  The user will also have several event handlers defined by using
     *  addHandler() and addTimedHandler().  These will allow the user code to
     *  respond to interesting stanzas or do something periodically with the
     *  connection.  These handlers will be active once authentication is
     *  finished.
     *
     *  To send data to the connection, use send().
     */

    /** Constructor: Strophe.Connection
     *  Create and initialize a Strophe.Connection object.
     *
     *  The transport-protocol for this connection will be chosen automatically
     *  based on the given service parameter. URLs starting with "ws://" or
     *  "wss://" will use WebSockets, URLs starting with "http://", "https://"
     *  or without a protocol will use BOSH.
     *
     *  To make Strophe connect to the current host you can leave out the protocol
     *  and host part and just pass the path, e.g.
     *
     *  > var conn = new Strophe.Connection("/http-bind/");
     *
     *  WebSocket options:
     *
     *  If you want to connect to the current host with a WebSocket connection you
     *  can tell Strophe to use WebSockets through a "protocol" attribute in the
     *  optional options parameter. Valid values are "ws" for WebSocket and "wss"
     *  for Secure WebSocket.
     *  So to connect to "wss://CURRENT_HOSTNAME/xmpp-websocket" you would call
     *
     *  > var conn = new Strophe.Connection("/xmpp-websocket/", {protocol: "wss"});
     *
     *  Note that relative URLs _NOT_ starting with a "/" will also include the path
     *  of the current site.
     *
     *  Also because downgrading security is not permitted by browsers, when using
     *  relative URLs both BOSH and WebSocket connections will use their secure
     *  variants if the current connection to the site is also secure (https).
     *
     *  BOSH options:
     *
     *  by adding "sync" to the options, you can control if requests will
     *  be made synchronously or not. The default behaviour is asynchronous.
     *  If you want to make requests synchronous, make "sync" evaluate to true:
     *  > var conn = new Strophe.Connection("/http-bind/", {sync: true});
     *  You can also toggle this on an already established connection:
     *  > conn.options.sync = true;
     *
     *
     *  Parameters:
     *    (String) service - The BOSH or WebSocket service URL.
     *    (Object) options - A hash of configuration options
     *
     *  Returns:
     *    A new Strophe.Connection object.
     */
    Strophe.Connection = function (service, options)
    {
        // The service URL
        this.service = service;

        // Configuration options
        this.options = options || {};
        var proto = this.options.protocol || "";

        // Select protocal based on service or options
        if (service.indexOf("ws:") === 0 || service.indexOf("wss:") === 0 ||
                proto.indexOf("ws") === 0) {
            this._proto = new Strophe.Websocket(this);
        } else {
            this._proto = new Bosh(this);
        }
        /* The connected JID. */
        this.jid = "";
        /* the JIDs domain */
        this.domain = null;
        /* stream:features */
        this.features = null;

        // SASL
        this._sasl_data = {};
        this.do_session = false;
        this.do_bind = false;

        // handler lists
        this.timedHandlers = [];
        this.handlers = [];
        this.removeTimeds = [];
        this.removeHandlers = [];
        this.addTimeds = [];
        this.addHandlers = [];

        this._authentication = {};
        this._idleTimeout = null;
        this._disconnectTimeout = null;

        this.do_authentication = true;
        this.authenticated = false;
        this.disconnecting = false;
        this.connected = false;

        this.errors = 0;

        this.paused = false;

        this._data = [];
        this._uniqueId = 0;

        this._sasl_success_handler = null;
        this._sasl_failure_handler = null;
        this._sasl_challenge_handler = null;

        // Max retries before disconnecting
        this.maxRetries = 5;

        // setup onIdle callback every 1/10th of a second
        this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);

        // initialize plugins
        for (var k in Strophe._connectionPlugins) {
            if (Strophe._connectionPlugins.hasOwnProperty(k)) {
                var ptype = Strophe._connectionPlugins[k];
                // jslint complaints about the below line, but this is fine
                var F = function () {}; // jshint ignore:line
                F.prototype = ptype;
                this[k] = new F();
                this[k].init(this);
            }
        }
    };

    Strophe.Connection.prototype = {
        /** Function: reset
         *  Reset the connection.
         *
         *  This function should be called after a connection is disconnected
         *  before that connection is reused.
         */
        reset: function ()
        {
            this._proto._reset();

            // SASL
            this.do_session = false;
            this.do_bind = false;

            // handler lists
            this.timedHandlers = [];
            this.handlers = [];
            this.removeTimeds = [];
            this.removeHandlers = [];
            this.addTimeds = [];
            this.addHandlers = [];
            this._authentication = {};

            this.authenticated = false;
            this.disconnecting = false;
            this.connected = false;

            this.errors = 0;

            this._requests = [];
            this._uniqueId = 0;
        },

        /** Function: pause
         *  Pause the request manager.
         *
         *  This will prevent Strophe from sending any more requests to the
         *  server.  This is very useful for temporarily pausing
         *  BOSH-Connections while a lot of send() calls are happening quickly.
         *  This causes Strophe to send the data in a single request, saving
         *  many request trips.
         */
        pause: function ()
        {
            this.paused = true;
        },

        /** Function: resume
         *  Resume the request manager.
         *
         *  This resumes after pause() has been called.
         */
        resume: function ()
        {
            this.paused = false;
        },

        /** Function: getUniqueId
         *  Generate a unique ID for use in <iq/> elements.
         *
         *  All <iq/> stanzas are required to have unique id attributes.  This
         *  function makes creating these easy.  Each connection instance has
         *  a counter which starts from zero, and the value of this counter
         *  plus a colon followed by the suffix becomes the unique id. If no
         *  suffix is supplied, the counter is used as the unique id.
         *
         *  Suffixes are used to make debugging easier when reading the stream
         *  data, and their use is recommended.  The counter resets to 0 for
         *  every new connection for the same reason.  For connections to the
         *  same server that authenticate the same way, all the ids should be
         *  the same, which makes it easy to see changes.  This is useful for
         *  automated testing as well.
         *
         *  Parameters:
         *    (String) suffix - A optional suffix to append to the id.
         *
         *  Returns:
         *    A unique string to be used for the id attribute.
         */
        getUniqueId: function (suffix)
        {
            if (typeof(suffix) == "string" || typeof(suffix) == "number") {
                return ++this._uniqueId + ":" + suffix;
            } else {
                return ++this._uniqueId + "";
            }
        },

        /** Function: connect
         *  Starts the connection process.
         *
         *  As the connection process proceeds, the user supplied callback will
         *  be triggered multiple times with status updates.  The callback
         *  should take two arguments - the status code and the error condition.
         *
         *  The status code will be one of the values in the Strophe.Status
         *  constants.  The error condition will be one of the conditions
         *  defined in RFC 3920 or the condition 'strophe-parsererror'.
         *
         *  The Parameters _wait_, _hold_ and _route_ are optional and only relevant
         *  for BOSH connections. Please see XEP 124 for a more detailed explanation
         *  of the optional parameters.
         *
         *  Parameters:
         *    (String) jid - The user's JID.  This may be a bare JID,
         *      or a full JID.  If a node is not supplied, SASL ANONYMOUS
         *      authentication will be attempted.
         *    (String) pass - The user's password.
         *    (Function) callback - The connect callback function.
         *    (Integer) wait - The optional HTTPBIND wait value.  This is the
         *      time the server will wait before returning an empty result for
         *      a request.  The default setting of 60 seconds is recommended.
         *    (Integer) hold - The optional HTTPBIND hold value.  This is the
         *      number of connections the server will hold at one time.  This
         *      should almost always be set to 1 (the default).
         *    (String) route - The optional route value.
         */
        connect: function (jid, pass, callback, wait, hold, route)
        {
            this.jid = jid;
            /** Variable: authzid
             *  Authorization identity.
             */
            this.authzid = Strophe.getBareJidFromJid(this.jid);
            /** Variable: authcid
             *  Authentication identity (User name).
             */
            this.authcid = Strophe.getNodeFromJid(this.jid);
            /** Variable: pass
             *  Authentication identity (User password).
             */
            this.pass = pass;
            /** Variable: servtype
             *  Digest MD5 compatibility.
             */
            this.servtype = "xmpp";
            this.connect_callback = callback;
            this.disconnecting = false;
            this.connected = false;
            this.authenticated = false;
            this.errors = 0;

            // parse jid for domain
            this.domain = Strophe.getDomainFromJid(this.jid);

            this._changeConnectStatus(Strophe.Status.CONNECTING, null);

            this._proto._connect(wait, hold, route);
        },

        /** Function: attach
         *  Attach to an already created and authenticated BOSH session.
         *
         *  This function is provided to allow Strophe to attach to BOSH
         *  sessions which have been created externally, perhaps by a Web
         *  application.  This is often used to support auto-login type features
         *  without putting user credentials into the page.
         *
         *  Parameters:
         *    (String) jid - The full JID that is bound by the session.
         *    (String) sid - The SID of the BOSH session.
         *    (String) rid - The current RID of the BOSH session.  This RID
         *      will be used by the next request.
         *    (Function) callback The connect callback function.
         *    (Integer) wait - The optional HTTPBIND wait value.  This is the
         *      time the server will wait before returning an empty result for
         *      a request.  The default setting of 60 seconds is recommended.
         *      Other settings will require tweaks to the Strophe.TIMEOUT value.
         *    (Integer) hold - The optional HTTPBIND hold value.  This is the
         *      number of connections the server will hold at one time.  This
         *      should almost always be set to 1 (the default).
         *    (Integer) wind - The optional HTTBIND window value.  This is the
         *      allowed range of request ids that are valid.  The default is 5.
         */
        attach: function (jid, sid, rid, callback, wait, hold, wind)
        {
            this._proto._attach(jid, sid, rid, callback, wait, hold, wind);
        },

        /** Function: xmlInput
         *  User overrideable function that receives XML data coming into the
         *  connection.
         *
         *  The default function does nothing.  User code can override this with
         *  > Strophe.Connection.xmlInput = function (elem) {
         *  >   (user code)
         *  > };
         *
         *  Due to limitations of current Browsers' XML-Parsers the opening and closing
         *  <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
         *
         *  BOSH-Connections will have all stanzas wrapped in a <body> tag. See
         *  <Strophe.Bosh.strip> if you want to strip this tag.
         *
         *  Parameters:
         *    (XMLElement) elem - The XML data received by the connection.
         */
        /* jshint unused:false */
        xmlInput: function (elem)
        {
            return;
        },
        /* jshint unused:true */

        /** Function: xmlOutput
         *  User overrideable function that receives XML data sent to the
         *  connection.
         *
         *  The default function does nothing.  User code can override this with
         *  > Strophe.Connection.xmlOutput = function (elem) {
         *  >   (user code)
         *  > };
         *
         *  Due to limitations of current Browsers' XML-Parsers the opening and closing
         *  <stream> tag for WebSocket-Connoctions will be passed as selfclosing here.
         *
         *  BOSH-Connections will have all stanzas wrapped in a <body> tag. See
         *  <Strophe.Bosh.strip> if you want to strip this tag.
         *
         *  Parameters:
         *    (XMLElement) elem - The XMLdata sent by the connection.
         */
        /* jshint unused:false */
        xmlOutput: function (elem)
        {
            return;
        },
        /* jshint unused:true */

        /** Function: rawInput
         *  User overrideable function that receives raw data coming into the
         *  connection.
         *
         *  The default function does nothing.  User code can override this with
         *  > Strophe.Connection.rawInput = function (data) {
         *  >   (user code)
         *  > };
         *
         *  Parameters:
         *    (String) data - The data received by the connection.
         */
        /* jshint unused:false */
        rawInput: function (data)
        {
            return;
        },
        /* jshint unused:true */

        /** Function: rawOutput
         *  User overrideable function that receives raw data sent to the
         *  connection.
         *
         *  The default function does nothing.  User code can override this with
         *  > Strophe.Connection.rawOutput = function (data) {
         *  >   (user code)
         *  > };
         *
         *  Parameters:
         *    (String) data - The data sent by the connection.
         */
        /* jshint unused:false */
        rawOutput: function (data)
        {
            return;
        },
        /* jshint unused:true */

        /** Function: send
         *  Send a stanza.
         *
         *  This function is called to push data onto the send queue to
         *  go out over the wire.  Whenever a request is sent to the BOSH
         *  server, all pending data is sent and the queue is flushed.
         *
         *  Parameters:
         *    (XMLElement |
         *     [XMLElement] |
         *     Strophe.Builder) elem - The stanza to send.
         */
        send: function (elem)
        {
            if (elem === null) { return ; }
            if (typeof(elem.sort) === "function") {
                for (var i = 0; i < elem.length; i++) {
                    this._queueData(elem[i]);
                }
            } else if (typeof(elem.tree) === "function") {
                this._queueData(elem.tree());
            } else {
                this._queueData(elem);
            }

            this._proto._send();
        },

        /** Function: flush
         *  Immediately send any pending outgoing data.
         *
         *  Normally send() queues outgoing data until the next idle period
         *  (100ms), which optimizes network use in the common cases when
         *  several send()s are called in succession. flush() can be used to
         *  immediately send all pending data.
         */
        flush: function ()
        {
            // cancel the pending idle period and run the idle function
            // immediately
            clearTimeout(this._idleTimeout);
            this._onIdle();
        },

        /** Function: sendIQ
         *  Helper function to send IQ stanzas.
         *
         *  Parameters:
         *    (XMLElement) elem - The stanza to send.
         *    (Function) callback - The callback function for a successful request.
         *    (Function) errback - The callback function for a failed or timed
         *      out request.  On timeout, the stanza will be null.
         *    (Integer) timeout - The time specified in milliseconds for a
         *      timeout to occur.
         *
         *  Returns:
         *    The id used to send the IQ.
        */
        sendIQ: function(elem, callback, errback, timeout) {
            var timeoutHandler = null;
            var that = this;

            if (typeof(elem.tree) === "function") {
                elem = elem.tree();
            }
            var id = elem.getAttribute('id');

            // inject id if not found
            if (!id) {
                id = this.getUniqueId("sendIQ");
                elem.setAttribute("id", id);
            }

            var handler = this.addHandler(function (stanza) {
                // remove timeout handler if there is one
                if (timeoutHandler) {
                    that.deleteTimedHandler(timeoutHandler);
                }

                var iqtype = stanza.getAttribute('type');
                if (iqtype == 'result') {
                    if (callback) {
                        callback(stanza);
                    }
                } else if (iqtype == 'error') {
                    if (errback) {
                        errback(stanza);
                    }
                } else {
                    throw {
                        name: "StropheError",
                message: "Got bad IQ type of " + iqtype
                    };
                }
            }, null, 'iq', null, id);

            // if timeout specified, setup timeout handler.
            if (timeout) {
                timeoutHandler = this.addTimedHandler(timeout, function () {
                    // get rid of normal handler
                    that.deleteHandler(handler);

                    // call errback on timeout with null stanza
                    if (errback) {
                        errback(null);
                    }
                    return false;
                });
            }

            this.send(elem);

            return id;
        },

        /** PrivateFunction: _queueData
         *  Queue outgoing data for later sending.  Also ensures that the data
         *  is a DOMElement.
         */
        _queueData: function (element) {
            if (element === null ||
                !element.tagName ||
                !element.childNodes) {
                throw {
                    name: "StropheError",
                    message: "Cannot queue non-DOMElement."
                };
            }

            this._data.push(element);
        },

        /** PrivateFunction: _sendRestart
         *  Send an xmpp:restart stanza.
         */
        _sendRestart: function ()
        {
            this._data.push("restart");

            this._proto._sendRestart();

            this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);
        },

        /** Function: addTimedHandler
         *  Add a timed handler to the connection.
         *
         *  This function adds a timed handler.  The provided handler will
         *  be called every period milliseconds until it returns false,
         *  the connection is terminated, or the handler is removed.  Handlers
         *  that wish to continue being invoked should return true.
         *
         *  Because of method binding it is necessary to save the result of
         *  this function if you wish to remove a handler with
         *  deleteTimedHandler().
         *
         *  Note that user handlers are not active until authentication is
         *  successful.
         *
         *  Parameters:
         *    (Integer) period - The period of the handler.
         *    (Function) handler - The callback function.
         *
         *  Returns:
         *    A reference to the handler that can be used to remove it.
         */
        addTimedHandler: function (period, handler)
        {
            var thand = new Strophe.TimedHandler(period, handler);
            this.addTimeds.push(thand);
            return thand;
        },

        /** Function: deleteTimedHandler
         *  Delete a timed handler for a connection.
         *
         *  This function removes a timed handler from the connection.  The
         *  handRef parameter is *not* the function passed to addTimedHandler(),
         *  but is the reference returned from addTimedHandler().
         *
         *  Parameters:
         *    (Strophe.TimedHandler) handRef - The handler reference.
         */
        deleteTimedHandler: function (handRef)
        {
            // this must be done in the Idle loop so that we don't change
            // the handlers during iteration
            this.removeTimeds.push(handRef);
        },

        /** Function: addHandler
         *  Add a stanza handler for the connection.
         *
         *  This function adds a stanza handler to the connection.  The
         *  handler callback will be called for any stanza that matches
         *  the parameters.  Note that if multiple parameters are supplied,
         *  they must all match for the handler to be invoked.
         *
         *  The handler will receive the stanza that triggered it as its argument.
         *  The handler should return true if it is to be invoked again;
         *  returning false will remove the handler after it returns.
         *
         *  As a convenience, the ns parameters applies to the top level element
         *  and also any of its immediate children.  This is primarily to make
         *  matching /iq/query elements easy.
         *
         *  The options argument contains handler matching flags that affect how
         *  matches are determined. Currently the only flag is matchBare (a
         *  boolean). When matchBare is true, the from parameter and the from
         *  attribute on the stanza will be matched as bare JIDs instead of
         *  full JIDs. To use this, pass {matchBare: true} as the value of
         *  options. The default value for matchBare is false.
         *
         *  The return value should be saved if you wish to remove the handler
         *  with deleteHandler().
         *
         *  Parameters:
         *    (Function) handler - The user callback.
         *    (String) ns - The namespace to match.
         *    (String) name - The stanza name to match.
         *    (String) type - The stanza type attribute to match.
         *    (String) id - The stanza id attribute to match.
         *    (String) from - The stanza from attribute to match.
         *    (String) options - The handler options
         *
         *  Returns:
         *    A reference to the handler that can be used to remove it.
         */
        addHandler: function (handler, ns, name, type, id, from, options)
        {
            var hand = new Strophe.Handler(handler, ns, name, type, id, from, options);
            this.addHandlers.push(hand);
            return hand;
        },

        /** Function: deleteHandler
         *  Delete a stanza handler for a connection.
         *
         *  This function removes a stanza handler from the connection.  The
         *  handRef parameter is *not* the function passed to addHandler(),
         *  but is the reference returned from addHandler().
         *
         *  Parameters:
         *    (Strophe.Handler) handRef - The handler reference.
         */
        deleteHandler: function (handRef)
        {
            // this must be done in the Idle loop so that we don't change
            // the handlers during iteration
            this.removeHandlers.push(handRef);
        },

        /** Function: disconnect
         *  Start the graceful disconnection process.
         *
         *  This function starts the disconnection process.  This process starts
         *  by sending unavailable presence and sending BOSH body of type
         *  terminate.  A timeout handler makes sure that disconnection happens
         *  even if the BOSH server does not respond.
         *
         *  The user supplied connection callback will be notified of the
         *  progress as this process happens.
         *
         *  Parameters:
         *    (String) reason - The reason the disconnect is occuring.
         */
        disconnect: function (reason)
        {
            this._changeConnectStatus(Strophe.Status.DISCONNECTING, reason);

            Strophe.info("Disconnect was called because: " + reason);
            if (this.connected) {
                var pres = false;
                this.disconnecting = true;
                if (this.authenticated) {
                    pres = $pres({
                        xmlns: Strophe.NS.CLIENT,
                        type: 'unavailable'
                    });
                }
                // setup timeout handler
                this._disconnectTimeout = this._addSysTimedHandler(
                    3000, this._onDisconnectTimeout.bind(this));
                this._proto._disconnect(pres);
            }
        },

        /** PrivateFunction: _changeConnectStatus
         *  _Private_ helper function that makes sure plugins and the user's
         *  callback are notified of connection status changes.
         *
         *  Parameters:
         *    (Integer) status - the new connection status, one of the values
         *      in Strophe.Status
         *    (String) condition - the error condition or null
         */
        _changeConnectStatus: function (status, condition)
        {
            // notify all plugins listening for status changes
            for (var k in Strophe._connectionPlugins) {
                if (Strophe._connectionPlugins.hasOwnProperty(k)) {
                    var plugin = this[k];
                    if (plugin.statusChanged) {
                        try {
                            plugin.statusChanged(status, condition);
                        } catch (err) {
                            Strophe.error("" + k + " plugin caused an exception " +
                                          "changing status: " + err);
                        }
                    }
                }
            }

            // notify the user's callback
            if (this.connect_callback) {
                try {
                    this.connect_callback(status, condition);
                } catch (e) {
                    Strophe.error("User connection callback caused an " +
                                  "exception: " + e);
                }
            }
        },

        /** PrivateFunction: _doDisconnect
         *  _Private_ function to disconnect.
         *
         *  This is the last piece of the disconnection logic.  This resets the
         *  connection and alerts the user's connection callback.
         */
        _doDisconnect: function ()
        {
            // Cancel Disconnect Timeout
            if (this._disconnectTimeout !== null) {
                this.deleteTimedHandler(this._disconnectTimeout);
                this._disconnectTimeout = null;
            }

            Strophe.info("_doDisconnect was called");
            this._proto._doDisconnect();

            this.authenticated = false;
            this.disconnecting = false;

            // delete handlers
            this.handlers = [];
            this.timedHandlers = [];
            this.removeTimeds = [];
            this.removeHandlers = [];
            this.addTimeds = [];
            this.addHandlers = [];

            // tell the parent we disconnected
            this._changeConnectStatus(Strophe.Status.DISCONNECTED, null);
            this.connected = false;
        },

        /** PrivateFunction: _dataRecv
         *  _Private_ handler to processes incoming data from the the connection.
         *
         *  Except for _connect_cb handling the initial connection request,
         *  this function handles the incoming data for all requests.  This
         *  function also fires stanza handlers that match each incoming
         *  stanza.
         *
         *  Parameters:
         *    (Strophe.Request) req - The request that has data ready.
         *    (string) req - The stanza a raw string (optiona).
         */
        _dataRecv: function (req, raw)
        {
            Strophe.info("_dataRecv called");
            var elem = this._proto._reqToData(req);
            if (elem === null) { return; }

            if (this.xmlInput !== Strophe.Connection.prototype.xmlInput) {
                if (elem.nodeName === this._proto.strip && elem.childNodes.length) {
                    this.xmlInput(elem.childNodes[0]);
                } else {
                    this.xmlInput(elem);
                }
            }
            if (this.rawInput !== Strophe.Connection.prototype.rawInput) {
                if (raw) {
                    this.rawInput(raw);
                } else {
                    this.rawInput(Strophe.serialize(elem));
                }
            }

            // remove handlers scheduled for deletion
            var i, hand;
            while (this.removeHandlers.length > 0) {
                hand = this.removeHandlers.pop();
                i = this.handlers.indexOf(hand);
                if (i >= 0) {
                    this.handlers.splice(i, 1);
                }
            }

            // add handlers scheduled for addition
            while (this.addHandlers.length > 0) {
                this.handlers.push(this.addHandlers.pop());
            }

            // handle graceful disconnect
            if (this.disconnecting && this._proto._emptyQueue()) {
                this._doDisconnect();
                return;
            }

            var typ = elem.getAttribute("type");
            var cond, conflict;
            if (typ !== null && typ == "terminate") {
                // Don't process stanzas that come in after disconnect
                if (this.disconnecting) {
                    return;
                }

                // an error occurred
                cond = elem.getAttribute("condition");
                conflict = elem.getElementsByTagName("conflict");
                if (cond !== null) {
                    if (cond == "remote-stream-error" && conflict.length > 0) {
                        cond = "conflict";
                    }
                    this._changeConnectStatus(Strophe.Status.CONNFAIL, cond);
                } else {
                    this._changeConnectStatus(Strophe.Status.CONNFAIL, "unknown");
                }
                this.disconnect('unknown stream-error');
                return;
            }

            // send each incoming stanza through the handler chain
            var that = this;
            Strophe.forEachChild(elem, null, function (child) {
                var i, newList;
                // process handlers
                newList = that.handlers;
                that.handlers = [];
                for (i = 0; i < newList.length; i++) {
                    var hand = newList[i];
                    // encapsulate 'handler.run' not to lose the whole handler list if
                    // one of the handlers throws an exception
                    try {
                        if (hand.isMatch(child) &&
                            (that.authenticated || !hand.user)) {
                            if (hand.run(child)) {
                                that.handlers.push(hand);
                            }
                        } else {
                            that.handlers.push(hand);
                        }
                    } catch(e) {
                        // if the handler throws an exception, we consider it as false
                        Strophe.warn('Removing Strophe handlers due to uncaught exception: ' + e.message);
                    }
                }
            });
        },


        /** Attribute: mechanisms
         *  SASL Mechanisms available for Conncection.
         */
        mechanisms: {},

        /** PrivateFunction: _connect_cb
         *  _Private_ handler for initial connection request.
         *
         *  This handler is used to process the initial connection request
         *  response from the BOSH server. It is used to set up authentication
         *  handlers and start the authentication process.
         *
         *  SASL authentication will be attempted if available, otherwise
         *  the code will fall back to legacy authentication.
         *
         *  Parameters:
         *    (Strophe.Request) req - The current request.
         *    (Function) _callback - low level (xmpp) connect callback function.
         *      Useful for plugins with their own xmpp connect callback (when their)
         *      want to do something special).
         */
        _connect_cb: function (req, _callback, raw)
        {
            Strophe.info("_connect_cb was called");

            this.connected = true;

            var bodyWrap = this._proto._reqToData(req);
            if (!bodyWrap) { return; }

            if (this.xmlInput !== Strophe.Connection.prototype.xmlInput) {
                if (bodyWrap.nodeName === this._proto.strip && bodyWrap.childNodes.length) {
                    this.xmlInput(bodyWrap.childNodes[0]);
                } else {
                    this.xmlInput(bodyWrap);
                }
            }
            if (this.rawInput !== Strophe.Connection.prototype.rawInput) {
                if (raw) {
                    this.rawInput(raw);
                } else {
                    this.rawInput(Strophe.serialize(bodyWrap));
                }
            }

            var conncheck = this._proto._connect_cb(bodyWrap);
            if (conncheck === Strophe.Status.CONNFAIL) {
                return;
            }

            this._authentication.sasl_scram_sha1 = false;
            this._authentication.sasl_plain = false;
            this._authentication.sasl_digest_md5 = false;
            this._authentication.sasl_anonymous = false;

            this._authentication.legacy_auth = false;

            // Check for the stream:features tag
            var hasFeatures = bodyWrap.getElementsByTagName("stream:features").length > 0;
            if (!hasFeatures) {
                hasFeatures = bodyWrap.getElementsByTagName("features").length > 0;
            }
            var mechanisms = bodyWrap.getElementsByTagName("mechanism");
            var matched = [];
            var i, mech, found_authentication = false;
            if (!hasFeatures) {
                this._proto._no_auth_received(_callback);
                return;
            }
            if (mechanisms.length > 0) {
                for (i = 0; i < mechanisms.length; i++) {
                    mech = Strophe.getText(mechanisms[i]);
                    if (this.mechanisms[mech]) matched.push(this.mechanisms[mech]);
                }
            }
            this._authentication.legacy_auth =
                bodyWrap.getElementsByTagName("auth").length > 0;
            found_authentication = this._authentication.legacy_auth ||
                matched.length > 0;
            if (!found_authentication) {
                this._proto._no_auth_received(_callback);
                return;
            }
            if (this.do_authentication !== false)
                this.authenticate(matched);
        },

        /** Function: authenticate
         * Set up authentication
         *
         *  Contiunues the initial connection request by setting up authentication
         *  handlers and start the authentication process.
         *
         *  SASL authentication will be attempted if available, otherwise
         *  the code will fall back to legacy authentication.
         *
         */
        authenticate: function (matched)
        {
          var i;
          // Sorting matched mechanisms according to priority.
          for (i = 0; i < matched.length - 1; ++i) {
            var higher = i;
            for (var j = i + 1; j < matched.length; ++j) {
              if (matched[j].prototype.priority > matched[higher].prototype.priority) {
                higher = j;
              }
            }
            if (higher != i) {
              var swap = matched[i];
              matched[i] = matched[higher];
              matched[higher] = swap;
            }
          }

          // run each mechanism
          var mechanism_found = false;
          for (i = 0; i < matched.length; ++i) {
            if (!matched[i].test(this)) continue;

            this._sasl_success_handler = this._addSysHandler(
              this._sasl_success_cb.bind(this), null,
              "success", null, null);
            this._sasl_failure_handler = this._addSysHandler(
              this._sasl_failure_cb.bind(this), null,
              "failure", null, null);
            this._sasl_challenge_handler = this._addSysHandler(
              this._sasl_challenge_cb.bind(this), null,
              "challenge", null, null);

            this._sasl_mechanism = new matched[i]();
            this._sasl_mechanism.onStart(this);

            var request_auth_exchange = $build("auth", {
              xmlns: Strophe.NS.SASL,
              mechanism: this._sasl_mechanism.name
            });

            if (this._sasl_mechanism.isClientFirst) {
              var response = this._sasl_mechanism.onChallenge(this, null);
              request_auth_exchange.t(Base64.encode(response));
            }

            this.send(request_auth_exchange.tree());

            mechanism_found = true;
            break;
          }

          if (!mechanism_found) {
            // if none of the mechanism worked
            if (Strophe.getNodeFromJid(this.jid) === null) {
                // we don't have a node, which is required for non-anonymous
                // client connections
                this._changeConnectStatus(Strophe.Status.CONNFAIL,
                                          'x-strophe-bad-non-anon-jid');
                this.disconnect('x-strophe-bad-non-anon-jid');
            } else {
              // fall back to legacy authentication
              this._changeConnectStatus(Strophe.Status.AUTHENTICATING, null);
              this._addSysHandler(this._auth1_cb.bind(this), null, null,
                                  null, "_auth_1");

              this.send($iq({
                type: "get",
                to: this.domain,
                id: "_auth_1"
              }).c("query", {
                xmlns: Strophe.NS.AUTH
              }).c("username", {}).t(Strophe.getNodeFromJid(this.jid)).tree());
            }
          }

        },

        _sasl_challenge_cb: function(elem) {
          var challenge = Base64.decode(Strophe.getText(elem));
          var response = this._sasl_mechanism.onChallenge(this, challenge);

          var stanza = $build('response', {
              xmlns: Strophe.NS.SASL
          });
          if (response !== "") {
            stanza.t(Base64.encode(response));
          }
          this.send(stanza.tree());

          return true;
        },

        /** PrivateFunction: _auth1_cb
         *  _Private_ handler for legacy authentication.
         *
         *  This handler is called in response to the initial <iq type='get'/>
         *  for legacy authentication.  It builds an authentication <iq/> and
         *  sends it, creating a handler (calling back to _auth2_cb()) to
         *  handle the result
         *
         *  Parameters:
         *    (XMLElement) elem - The stanza that triggered the callback.
         *
         *  Returns:
         *    false to remove the handler.
         */
        /* jshint unused:false */
        _auth1_cb: function (elem)
        {
            // build plaintext auth iq
            var iq = $iq({type: "set", id: "_auth_2"})
                .c('query', {xmlns: Strophe.NS.AUTH})
                .c('username', {}).t(Strophe.getNodeFromJid(this.jid))
                .up()
                .c('password').t(this.pass);

            if (!Strophe.getResourceFromJid(this.jid)) {
                // since the user has not supplied a resource, we pick
                // a default one here.  unlike other auth methods, the server
                // cannot do this for us.
                this.jid = Strophe.getBareJidFromJid(this.jid) + '/strophe';
            }
            iq.up().c('resource', {}).t(Strophe.getResourceFromJid(this.jid));

            this._addSysHandler(this._auth2_cb.bind(this), null,
                                null, null, "_auth_2");

            this.send(iq.tree());

            return false;
        },
        /* jshint unused:true */

        /** PrivateFunction: _sasl_success_cb
         *  _Private_ handler for succesful SASL authentication.
         *
         *  Parameters:
         *    (XMLElement) elem - The matching stanza.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _sasl_success_cb: function (elem)
        {
            if (this._sasl_data["server-signature"]) {
                var serverSignature;
                var success = Base64.decode(Strophe.getText(elem));
                var attribMatch = /([a-z]+)=([^,]+)(,|$)/;
                var matches = success.match(attribMatch);
                if (matches[1] == "v") {
                    serverSignature = matches[2];
                }

                if (serverSignature != this._sasl_data["server-signature"]) {
                  // remove old handlers
                  this.deleteHandler(this._sasl_failure_handler);
                  this._sasl_failure_handler = null;
                  if (this._sasl_challenge_handler) {
                    this.deleteHandler(this._sasl_challenge_handler);
                    this._sasl_challenge_handler = null;
                  }

                  this._sasl_data = {};
                  return this._sasl_failure_cb(null);
                }
            }

            Strophe.info("SASL authentication succeeded.");

            if(this._sasl_mechanism)
              this._sasl_mechanism.onSuccess();

            // remove old handlers
            this.deleteHandler(this._sasl_failure_handler);
            this._sasl_failure_handler = null;
            if (this._sasl_challenge_handler) {
                this.deleteHandler(this._sasl_challenge_handler);
                this._sasl_challenge_handler = null;
            }

            this._addSysHandler(this._sasl_auth1_cb.bind(this), null,
                                "stream:features", null, null);

            // we must send an xmpp:restart now
            this._sendRestart();

            return false;
        },

        /** PrivateFunction: _sasl_auth1_cb
         *  _Private_ handler to start stream binding.
         *
         *  Parameters:
         *    (XMLElement) elem - The matching stanza.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _sasl_auth1_cb: function (elem)
        {
            // save stream:features for future usage
            this.features = elem;

            var i, child;

            for (i = 0; i < elem.childNodes.length; i++) {
                child = elem.childNodes[i];
                if (child.nodeName == 'bind') {
                    this.do_bind = true;
                }

                if (child.nodeName == 'session') {
                    this.do_session = true;
                }
            }

            if (!this.do_bind) {
                this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
                return false;
            } else {
                this._addSysHandler(this._sasl_bind_cb.bind(this), null, null,
                                    null, "_bind_auth_2");

                var resource = Strophe.getResourceFromJid(this.jid);
                if (resource) {
                    this.send($iq({type: "set", id: "_bind_auth_2"})
                              .c('bind', {xmlns: Strophe.NS.BIND})
                              .c('resource', {}).t(resource).tree());
                } else {
                    this.send($iq({type: "set", id: "_bind_auth_2"})
                              .c('bind', {xmlns: Strophe.NS.BIND})
                              .tree());
                }
            }

            return false;
        },

        /** PrivateFunction: _sasl_bind_cb
         *  _Private_ handler for binding result and session start.
         *
         *  Parameters:
         *    (XMLElement) elem - The matching stanza.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _sasl_bind_cb: function (elem)
        {
            if (elem.getAttribute("type") == "error") {
                Strophe.info("SASL binding failed.");
                var conflict = elem.getElementsByTagName("conflict"), condition;
                if (conflict.length > 0) {
                    condition = 'conflict';
                }
                this._changeConnectStatus(Strophe.Status.AUTHFAIL, condition);
                return false;
            }

            // TODO - need to grab errors
            var bind = elem.getElementsByTagName("bind");
            var jidNode;
            if (bind.length > 0) {
                // Grab jid
                jidNode = bind[0].getElementsByTagName("jid");
                if (jidNode.length > 0) {
                    this.jid = Strophe.getText(jidNode[0]);

                    if (this.do_session) {
                        this._addSysHandler(this._sasl_session_cb.bind(this),
                                            null, null, null, "_session_auth_2");

                        this.send($iq({type: "set", id: "_session_auth_2"})
                                      .c('session', {xmlns: Strophe.NS.SESSION})
                                      .tree());
                    } else {
                        this.authenticated = true;
                        this._changeConnectStatus(Strophe.Status.CONNECTED, null);
                    }
                }
            } else {
                Strophe.info("SASL binding failed.");
                this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
                return false;
            }
        },

        /** PrivateFunction: _sasl_session_cb
         *  _Private_ handler to finish successful SASL connection.
         *
         *  This sets Connection.authenticated to true on success, which
         *  starts the processing of user handlers.
         *
         *  Parameters:
         *    (XMLElement) elem - The matching stanza.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _sasl_session_cb: function (elem)
        {
            if (elem.getAttribute("type") == "result") {
                this.authenticated = true;
                this._changeConnectStatus(Strophe.Status.CONNECTED, null);
            } else if (elem.getAttribute("type") == "error") {
                Strophe.info("Session creation failed.");
                this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
                return false;
            }

            return false;
        },

        /** PrivateFunction: _sasl_failure_cb
         *  _Private_ handler for SASL authentication failure.
         *
         *  Parameters:
         *    (XMLElement) elem - The matching stanza.
         *
         *  Returns:
         *    false to remove the handler.
         */
        /* jshint unused:false */
        _sasl_failure_cb: function (elem)
        {
            // delete unneeded handlers
            if (this._sasl_success_handler) {
                this.deleteHandler(this._sasl_success_handler);
                this._sasl_success_handler = null;
            }
            if (this._sasl_challenge_handler) {
                this.deleteHandler(this._sasl_challenge_handler);
                this._sasl_challenge_handler = null;
            }

            if(this._sasl_mechanism)
              this._sasl_mechanism.onFailure();
            this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
            return false;
        },
        /* jshint unused:true */

        /** PrivateFunction: _auth2_cb
         *  _Private_ handler to finish legacy authentication.
         *
         *  This handler is called when the result from the jabber:iq:auth
         *  <iq/> stanza is returned.
         *
         *  Parameters:
         *    (XMLElement) elem - The stanza that triggered the callback.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _auth2_cb: function (elem)
        {
            if (elem.getAttribute("type") == "result") {
                this.authenticated = true;
                this._changeConnectStatus(Strophe.Status.CONNECTED, null);
            } else if (elem.getAttribute("type") == "error") {
                this._changeConnectStatus(Strophe.Status.AUTHFAIL, null);
                this.disconnect('authentication failed');
            }

            return false;
        },

        /** PrivateFunction: _addSysTimedHandler
         *  _Private_ function to add a system level timed handler.
         *
         *  This function is used to add a Strophe.TimedHandler for the
         *  library code.  System timed handlers are allowed to run before
         *  authentication is complete.
         *
         *  Parameters:
         *    (Integer) period - The period of the handler.
         *    (Function) handler - The callback function.
         */
        _addSysTimedHandler: function (period, handler)
        {
            var thand = new Strophe.TimedHandler(period, handler);
            thand.user = false;
            this.addTimeds.push(thand);
            return thand;
        },

        /** PrivateFunction: _addSysHandler
         *  _Private_ function to add a system level stanza handler.
         *
         *  This function is used to add a Strophe.Handler for the
         *  library code.  System stanza handlers are allowed to run before
         *  authentication is complete.
         *
         *  Parameters:
         *    (Function) handler - The callback function.
         *    (String) ns - The namespace to match.
         *    (String) name - The stanza name to match.
         *    (String) type - The stanza type attribute to match.
         *    (String) id - The stanza id attribute to match.
         */
        _addSysHandler: function (handler, ns, name, type, id)
        {
            var hand = new Strophe.Handler(handler, ns, name, type, id);
            hand.user = false;
            this.addHandlers.push(hand);
            return hand;
        },

        /** PrivateFunction: _onDisconnectTimeout
         *  _Private_ timeout handler for handling non-graceful disconnection.
         *
         *  If the graceful disconnect process does not complete within the
         *  time allotted, this handler finishes the disconnect anyway.
         *
         *  Returns:
         *    false to remove the handler.
         */
        _onDisconnectTimeout: function ()
        {
            Strophe.info("_onDisconnectTimeout was called");

            this._proto._onDisconnectTimeout();

            // actually disconnect
            this._doDisconnect();

            return false;
        },

        /** PrivateFunction: _onIdle
         *  _Private_ handler to process events during idle cycle.
         *
         *  This handler is called every 100ms to fire timed handlers that
         *  are ready and keep poll requests going.
         */
        _onIdle: function ()
        {
            var i, thand, since, newList;

            // add timed handlers scheduled for addition
            // NOTE: we add before remove in the case a timed handler is
            // added and then deleted before the next _onIdle() call.
            while (this.addTimeds.length > 0) {
                this.timedHandlers.push(this.addTimeds.pop());
            }

            // remove timed handlers that have been scheduled for deletion
            while (this.removeTimeds.length > 0) {
                thand = this.removeTimeds.pop();
                i = this.timedHandlers.indexOf(thand);
                if (i >= 0) {
                    this.timedHandlers.splice(i, 1);
                }
            }

            // call ready timed handlers
            var now = new Date().getTime();
            newList = [];
            for (i = 0; i < this.timedHandlers.length; i++) {
                thand = this.timedHandlers[i];
                if (this.authenticated || !thand.user) {
                    since = thand.lastCalled + thand.period;
                    if (since - now <= 0) {
                        if (thand.run()) {
                            newList.push(thand);
                        }
                    } else {
                        newList.push(thand);
                    }
                }
            }
            this.timedHandlers = newList;

            clearTimeout(this._idleTimeout);

            this._proto._onIdle();

            // reactivate the timer only if connected
            if (this.connected) {
                this._idleTimeout = setTimeout(this._onIdle.bind(this), 100);
            }
        }
    };

    return Strophe.Connection;
}));