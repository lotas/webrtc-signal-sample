'use strict';

var server = require('http').createServer()
var WebSocketServer = require('ws').Server;
var express = require('express');

var path = require('path');
var fs = require('fs');

var port = process.env.PORT || 8000;
var host = process.env.HOST || 'localhost';

var app = express();
app.use(express.static(path.join(__dirname, 'public')));

server.listen(port, () => {
    console.log(`Listening to http://${host}:${port}/`);
});
server.on('request', app);


var wss = new WebSocketServer({
    server: server,
    path: '/call'
});

var registry = new Registry();

wss.on('connection', (socket) => {
    var sessionId = uniqId();
    console.log(`New connection #${sessionId}`);

    socket.on('error', error => {
        console.log(`Connection ${sessionId} error: ${error}`);
    });
    socket.on('close', () => {
        console.log(`Connection ${sessionId} closed`);
        registry.unregister(sessionId);
    });
    socket.on('message', msg => {
        var message = JSON.parse(msg);
        console.log(`Connection ${sessionId} incoming: ${msg.substr(0, 70)}`);

        switch (message.id) {
            case 'register':
                if (registry.getByName(message.name)) {
                    return socket.send(JSON.stringify({
                        id: 'registerResponse',
                        response: 'rejected'
                    }));
                }
                let user = new UserSession(sessionId, message.name, socket);
                registry.register(user);
                user.sendMessage({id: 'registerResponse', response: 'accepted'});
                break;

            case 'list':
                socket.send(JSON.stringify({
                    id: 'listResponse',
                    list: registry.list()
                }));
                break;

            case 'stop': 

                break;

            case 'onIceCandidate': 
                onIceCandidate(sessionId, message.candidate);
                break;
            case 'answer': 
                onAnswer(sessionId, message);
                break;

            case 'call':
                call(sessionId, message.to, message.from, message.sdpOffer);
                break;

            case 'incomingCallResponse':
                incomingCallResponse(sessionId, message.from, message.callResponse, message.sdpOffer, socket);
                break;

            case 'ping':
                socket.send(JSON.stringify({
                    id: 'pong'
                }));
                break;
        }
    });
});

function call(id, to, from, sdpOffer) {
    var caller = registry.getByName(from);
    if (registry.getByName(to)) {
        var callee = registry.getByName(to);
        caller.sdpOffer = sdpOffer;
        caller.peer = to;
        callee.peer = from;
        callee.sendMessage({
            id: 'incomingCall',
            from: from,
            offer: sdpOffer
        });
    } else {
        caller.sendMessage({
            id: 'callResponse',
            response: 'rejected',
            message: 'User not registered'
        });
    }
}

function incomingCallResponse(sessionId, from, callResponse, calleeSdp, ws) {
    var callee = registry.getById(sessionId);
    var caller = registry.getByName(from);

    console.log('incomingCallResponse', callee, caller, callResponse);

    if (!callee || !caller || callResponse !== 'accept') {
        return ws.send(JSON.stringify({
            id: 'callResponse',
            response: 'rejected'
        }));
    }

    caller.sendMessage({
        id: 'callResponse',
        response: 'accepted',
        sdpAnswer: calleeSdp //.sdp.replace(/a=setup:actpass/g, "a=setup:active")
    });

    // switch callee to active, because both cannot be active nor passive
    // var sdpOffer = caller.sdpOffer.sdp.replace(/a=setup:actpass/g, "a=setup:active");

    callee.sendMessage({
        id: 'startCommunication',
        sdpAnswer: caller.sdpOffer
    });
}

function onIceCandidate(sessionId, candidate) {
    var caller = registry.getById(sessionId);
    if (caller && caller.peer) {
        // console.log(`IceCandidate from ${sessionId} to ${caller.peer}`);
        var peer = registry.getByName(caller.peer);
        if (peer) {
            peer.sendMessage({
                id: 'iceCandidate',
                candidate: candidate
            });
        }
    }
}
function onAnswer(sessionId, message) {
    var caller = registry.getById(sessionId);
    if (caller && caller.peer) {
        // console.log(`IceCandidate from ${sessionId} to ${caller.peer}`);
        var peer = registry.getByName(caller.peer);
        if (peer) {
            peer.sendMessage({
                id: 'startCommunication',
                sdpAnswer: message.sdp
            });
        }
    }
}

function UserSession(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.peer = null;
    this.sdpOffer = null;
}
UserSession.prototype.sendMessage = function(msg) {
    this.ws.send(JSON.stringify(msg));
}

function Registry() {
    this.usersById = {};
    this.usersByName = {};
}
Registry.prototype.register = function(user) {
    this.usersById[user.id] = user;
    this.usersByName[user.name] = user;
}
Registry.prototype.unregister = function(id) {
    var user = this.getById(id);
    if (user) delete this.usersById[id]
    if (user && this.getByName(user.name)) delete this.usersByName[user.name];
}
Registry.prototype.getById = function(id) {
    return this.usersById[id];
}
Registry.prototype.getByName = function(name) {
    return this.usersByName[name];
}
Registry.prototype.removeById = function(id) {
    var userSession = this.usersById[id];
    if (!userSession) return;
    delete this.usersById[id];
    delete this.usersByName[userSession.name];
}
Registry.prototype.list = function() {
    return Object.keys(this.usersByName);
}

var uniqIdCnt = 0;
function uniqId() {
    uniqIdCnt++;
    return String(uniqIdCnt);
}