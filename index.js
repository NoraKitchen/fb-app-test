var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var config = require('config');
var witActions = require('./wit_app/wit-actions');



var Wit = null;
var log = null;
try {
    // if running from repo
    Wit = require('../').Wit;
} catch (e) {
    Wit = require('node-wit').Wit;
}

var port = process.env.PORT || 8080;
var server = express();
server.use(bodyParser.json());
server.listen(port, function () { console.log("Server running on port " + port) });

var VALIDATION_TOKEN = config.get("validationToken");
var WIT_TOKEN = config.get("witToken");


// Get the user session. The session stores the fbid of the user the conversation belongs to, and the Wit context object built through the conversation
// After a successful search, session is wiped
// sessionId -> {fbid: facebookUserId, context: sessionState}
var sessions = {};

function findOrCreateSession(fbid) {
    var sessionId;
    // Let's see if we already have a session for the user fbid
    Object.keys(sessions).forEach(function (key) {
        if (sessions[key].fbid === fbid) {
            // Yep, got it!
            sessionId = key;
        }
    });
    if (!sessionId) {
        // No session found for user fbid, let's create a new one
        sessionId = new Date().toISOString();
        //setting to findByCategory manually here for testing
        sessions[sessionId] = { fbid: fbid, context: {["uid"]: fbid, findByCategory: true} };
    }
    return sessionId;
};



//Set up webhook for facebook messenger platform
server.get('/webhook', function (req, res) {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === VALIDATION_TOKEN) {
        console.log("Validating webhook");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});



server.post('/webhook', function (req, res) {
    // console.log(util.inspect(req, {showHidden: false, depth: null}));
    var data = req.body;


    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    //   receivedAuthentication(messagingEvent);
                    console.log("auth event");
                } else if (messagingEvent.message) {
                    //   receivedMessage(messagingEvent);
                    console.log("got message");
                    var sender = messagingEvent.sender.id;

                    //*
                    //got a message from user, so figure out if have message history with user
                    var sessionId = findOrCreateSession(sender);
                    var senderText = messagingEvent.message.text;
                    //retrieve message content

                    //message could be message.text or message.attachment..
                    if (senderText) {
                        //forward to wit.ai bot engine
                        //bot will run all actions till nothing left to do 
                        wit.runActions(sender, senderText, sessions[sessionId].context
                        ).then(function (context) {
                            console.log("TEST: actions run complete");
                             sessions[sessionId].context = context;
                            //now bot is waiting for futher emssages?
                            //based on session state/business logic, might defcone session here
                            //if (context['done']){delete sessions[sessionId]}
                            if (sessions[sessionId].context.endSession) {
                                //search returned no results, ending session to restart search
                                console.log("restarting session")
                                delete sessions[sessionId];
                            } 
                            // else if (context.newContext) {
                            //     //code to display results here, possibly buttons to restart search or display more
                            //     //for now I am auto-deleting session/search till we have buttons to restart
                            //     console.log("restarting session")
                            //     delete sessions[sessionId];
                            // }

                        })
                    }

                    // callSendApi(messageData) was originally called here to send a reply back to user
                    //an equivalent function (sendFBMessage) is now called within the Wit 'send' action, which will always run during wit.runActions called above

                } else if (messagingEvent.delivery) {
                    //   receivedDeliveryConfirmation(messagingEvent);
                    console.log("got messagingEvent delivery");
                } else if (messagingEvent.postback) {
                    //   receivedPostback(messagingEvent);
                    console.log('got postback')
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        //
        // You must send back a 200, within 20 seconds, to let us know you've 
        // successfully received the callback. Otherwise, the request will time out.
        res.sendStatus(200);
    }
});




var wit = new Wit({ accessToken: WIT_TOKEN, actions: witActions.actions });