(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['./core'], function (Strophe) {
            // Also create a global in case some scripts
            // that are loaded still are looking for
            // a global even when an AMD loader is in use.
            return (root.Strophe.Request = factory(Strophe));
        });
    } else {
        // Browser globals
        root.Strophe.Request = factory(root.Strophe);
    }
}(this, function (Strophe) {

    /** PrivateClass: Strophe.Request
     *  _Private_ helper class that provides a cross implementation abstraction
     *  for a BOSH related XMLHttpRequest.
     *
     *  The Strophe.Request class is used internally to encapsulate BOSH request
     *  information.  It is not meant to be used from user's code.
     */

    /** PrivateConstructor: Strophe.Request
     *  Create and initialize a new Strophe.Request object.
     *
     *  Parameters:
     *    (XMLElement) elem - The XML data to be sent in the request.
     *    (Function) func - The function that will be called when the
     *      XMLHttpRequest readyState changes.
     *    (Integer) rid - The BOSH rid attribute associated with this request.
     *    (Integer) sends - The number of times this same request has been
     *      sent.
     */
    Strophe.Request = function (elem, func, rid, sends)
    {
        this.id = ++Strophe._requestId;
        this.xmlData = elem;
        this.data = Strophe.serialize(elem);
        // save original function in case we need to make a new request
        // from this one.
        this.origFunc = func;
        this.func = func;
        this.rid = rid;
        this.date = NaN;
        this.sends = sends || 0;
        this.abort = false;
        this.dead = null;

        this.age = function () {
            if (!this.date) { return 0; }
            var now = new Date();
            return (now - this.date) / 1000;
        };
        this.timeDead = function () {
            if (!this.dead) { return 0; }
            var now = new Date();
            return (now - this.dead) / 1000;
        };
        this.xhr = this._newXHR();
    };

    Strophe.Request.prototype = {
        /** PrivateFunction: getResponse
         *  Get a response from the underlying XMLHttpRequest.
         *
         *  This function attempts to get a response from the request and checks
         *  for errors.
         *
         *  Throws:
         *    "parsererror" - A parser error occured.
         *
         *  Returns:
         *    The DOM element tree of the response.
         */
        getResponse: function ()
        {
            var node = null;
            if (this.xhr.responseXML && this.xhr.responseXML.documentElement) {
                node = this.xhr.responseXML.documentElement;
                if (node.tagName == "parsererror") {
                    Strophe.error("invalid response received");
                    Strophe.error("responseText: " + this.xhr.responseText);
                    Strophe.error("responseXML: " +
                                  Strophe.serialize(this.xhr.responseXML));
                    throw "parsererror";
                }
            } else if (this.xhr.responseText) {
                Strophe.error("invalid response received");
                Strophe.error("responseText: " + this.xhr.responseText);
                Strophe.error("responseXML: " +
                              Strophe.serialize(this.xhr.responseXML));
            }

            return node;
        },

        /** PrivateFunction: _newXHR
         *  _Private_ helper function to create XMLHttpRequests.
         *
         *  This function creates XMLHttpRequests across all implementations.
         *
         *  Returns:
         *    A new XMLHttpRequest.
         */
        _newXHR: function ()
        {
            var xhr = null;
            if (window.XMLHttpRequest) {
                xhr = new XMLHttpRequest();
                if (xhr.overrideMimeType) {
                    xhr.overrideMimeType("text/xml");
                }
            } else if (window.ActiveXObject) {
                xhr = new ActiveXObject("Microsoft.XMLHTTP");
            }

            // use Function.bind() to prepend ourselves as an argument
            xhr.onreadystatechange = this.func.bind(null, this);

            return xhr;
        }
    };

    return Strophe.Request;
}));