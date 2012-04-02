var BOSH_SERVICE = 'http://zipline.local:5280/http-bind'
var WS_SERVICE = 'ws://msgboy.com:5288/ws-xmpp'

var connection = null;

function log(msg) 
{
	console.log(msg);
    $('#log').append('<div></div>').append(document.createTextNode(msg));
}

function rawInput(data)
{
    log('RECV: ' + data);
}

function rawOutput(data)
{
    log('SENT: ' + data);
}

function onConnect(status)
{
    if (status == Strophe.Status.CONNECTING) {
		log('Strophe is connecting.');
    } else if (status == Strophe.Status.CONNFAIL) {
		log('Strophe failed to connect.');
		$('#connect').get(0).value = 'connect';
	} else if(status == Strophe.Status.AUTHFAIL) {
		log('Strophe couldn\'t authenticate.');
    } else if (status == Strophe.Status.DISCONNECTING) {
		log('Strophe is disconnecting.');
    } else if (status == Strophe.Status.DISCONNECTED) {
		log('Strophe is disconnected.');
		$('#connect').get(0).value = 'connect';
    } else if (status == Strophe.Status.CONNECTED) {
		log('Strophe is connected.');
		log('ECHOBOT: Send a message to ' + connection.jid + ' to talk to me.');

	connection.addHandler(onMessage, null, 'message', null, null,  null); 
	connection.send($pres().tree());
    }
}

function onMessage(msg) {
    var to = msg.getAttribute('to');
    var from = msg.getAttribute('from');
    var type = msg.getAttribute('type');
    var elems = msg.getElementsByTagName('body');

    if (type == "chat" && elems.length > 0) {
	var body = elems[0];

	log('ECHOBOT: I got a message from ' + from + ': ' + Strophe.getText(body));
    
	var reply = $msg({to: from, type: 'chat'}).cnode(Strophe.copyElement(body));
	connection.send(reply.tree());

	log('ECHOBOT: I sent ' + from + ' : ' + Strophe.getText(body));
    }

    // we must return true to keep the handler alive.  
    // returning false would remove it after it finishes.
    return true;
}

$(document).ready(function () {
	proto = new Strophe.Websocket(WS_SERVICE)
	// proto = new Strophe.Bosh(BOSH_SERVICE)
    connection = new Strophe.Connection({protocol:proto });
    connection.rawInput = rawInput;
    connection.rawOutput = rawOutput;

    $('#connect').bind('click', function () {
	var button = $('#connect').get(0);
	if (button.value == 'connect') {
	    button.value = 'disconnect';

	    connection.connect($('#jid').get(0).value,
			       $('#pass').get(0).value,
			       onConnect);
	} else {
	    button.value = 'connect';
	    connection.disconnect();
	}
    });
});