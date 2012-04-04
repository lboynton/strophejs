/*
	Function to make sure we can ue a DomParser... even in IE
*/
if(typeof(DOMParser) == 'undefined') {
 DOMParser = function() {}
 DOMParser.prototype.parseFromString = function(str, contentType) {
  if(typeof(ActiveXObject) != 'undefined') {
   var xmldata = new ActiveXObject('MSXML.DomDocument');
   xmldata.async = false;
   xmldata.loadXML(str);
   return xmldata;
  } else if(typeof(XMLHttpRequest) != 'undefined') {
   var xmldata = new XMLHttpRequest;
   if(!contentType) {
    contentType = 'application/xml';
   }
   xmldata.open('GET', 'data:' + contentType + ';charset=utf-8,' + encodeURIComponent(str), false);
   if(xmldata.overrideMimeType) {
    xmldata.overrideMimeType(contentType);
   }
   xmldata.send(null);
   return xmldata.responseXML;
  }
 }
}

Strophe.Websocket = function(service)
{
    this.service = service;
};

Strophe.Websocket.prototype = {
    connect: function(connection, args)
    {
        this.connection = connection;
        this.socket = new WebSocket(this.service, "xmpp");
        this.socket.onopen = this._onOpen.bind(this);
        this.socket.onerror = this._onError.bind(this);
        this.socket.onclose = this._onClose.bind(this);
        this.socket.onmessage = this._onMessage.bind(this);
    },
    
    /** Function send 
	 *  Sends messages
	 */
	send: function(elem) 
    {
		this.connection.xmlOutput(elem);
        this.connection.rawOutput(Strophe.serialize(elem));
		this.socket.send(Strophe.serialize(elem));
	},
    
    /** PrivateFunction: _onError
     *  _Private_ function to handle websockets errors.
     *
     *  Parameters:
     *    () error - The websocket error.
     */
	_onError: function(error)
    {
		Strophe.log("Websocket error " + error);
	},

	/** PrivateFunction: _onOpen
     *  _Private_ function to handle websockets connections.
     *
     */
	_onOpen: function()
    {
		Strophe.log("Websocket open");
		this.connection.xmlOutput(this._startStream());
        this.connection.rawOutput(this._startStream());
		this.socket.send(this._startStream());
	},
	
	/** PrivateFunction: _onClose
     *  _Private_ function to handle websockets closing.
     *
	 */
	_onClose: function(event)
    {
		Strophe.log("Websocket disconnected");
		this.connection._doDisconnect();
	},
    
    _onMessage: function(message)
    {
        // Ugly hack to deal with the problem of stream ns undefined.
        var string = message.data.replace("<stream:features>", "<stream:features xmlns:stream='http://etherx.jabber.org/streams'>"),
		parser = new DOMParser(),
		node = parser.parseFromString(string, "text/xml").documentElement;
        
        if (message.data.indexOf('<stream:features') === 0) {
            this.connection._connect_cb(node);
        }
        else {
            this.connection._dataRecv(node);
        }
    },
	
	_startStream: function()
    {
		return "<stream:stream to='" + this.connection.domain + "' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0' />";
	},
	
	_endStream:function()
    {
		return "</stream:stream>";
	}
};