var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var fetch = require('node-fetch');
var config = require('config');
var port = process.env.PORT || 8080;


var server = express();
server.use(bodyParser.json());
server.listen(port, function () { console.log("server running on port " + port) });

// server.get('/test', function(req, res){
//     res.sendFile(__dirname + "/public/index.html");
// })
//dirname says use current directory path

// server.use('/test', express.static(__dirname + '/public'))

var VALIDATION_TOKEN = config.get("validationToken");
var PAGE_ACCESS_TOKEN = config.get("pageAccessToken");
var WIT_TOKEN = config.get("witToken");



//******WIT CODE******//
var Wit = null;
var log = null;
try {
    // if running from repo
    Wit = require('../').Wit;
} catch (e) {
    Wit = require('node-wit').Wit;
}


// Get the user session. The session stores the fbid of the user the conversation belongs to, and the Wit context objeect built through the conversation
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
        sessions[sessionId] = { fbid: fbid, context: {} };
    }
    return sessionId;
};


//The Wit actions object all functions you may call during the conversation
//And the 'send' function that says what happens whenever Wit formulates a reply and sends it back
//In this case we call sendFbMessage to send the response to the facebook user indicated
var actions = {
    send(request, response) {
        //in fb exaple had diff (args), think will work this way...

        // const {sessionId, context, entities} = request;
        // const {text, quickreplies} = response;

        //retrieve user whose session belongs to
        var recipientId = sessions[request.sessionId].fbid;
        if (recipientId) {
            return sendFbMessage(recipientId, response.text)
            .then(function(){
                return null;
            }) //.catch here 
            // return new Promise(function (resolve, reject) {
            //     console.log('user said...', request.text);
            //     console.log('sending...', JSON.stringify(response));
            //     return resolve();
            // });
        }
    },
    echoLocation({context:context, entities:entities}) {
        //this [0].value business is from the firstEntityValue code in the wit.ai example...guess it doesn't just come back as you'd expect, but as an array
        context.location = entities.location[0].value;
        return Promise.resolve(context);
    },
    longTime({context:context, entities:entities}) {
        context.years = Math.random() * (100 - 2) + 2;
        return Promise.resolve(context);
    },
};


//****END WIT CODE****//    



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


//
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
                        wit.runActions(sessionId, senderText, sessions[sessionId].context
                        ).then(function (context) {
                            console.log("actions run complete")
                            sessions[sessionId].context = context;
                            //now bot is waiting for futher emssages?
                            //based on session state/business logic, might defcone session here
                            //if (context['done']){delete sessions[sessionId]}
                        })
                    }

                    // callSendApi(messageData) was originally called here to send a reply back to user
                    //an equivalent function (sendFBMessage) is now called within the Wit 'send' action, which will always run during wit.runActions called above

                } else if (messagingEvent.delivery) {
                    //   receivedDeliveryConfirmation(messagingEvent);
                    console.log("got delivery");
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


function sendFbMessage(id, text) {
  var body = JSON.stringify({
      //upt in quotes, dunno if ness
    recipient: {"id": id},
    message: {"text": text},
  });
  //uses fetch instead of request like below
  var qs = 'access_token=' + encodeURIComponent(PAGE_ACCESS_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

//code from original just-fb version, similar to above
// function callSendApi(messageData) {
//     request({
//         uri: 'https://graph.facebook.com/v2.6/me/messages',
//         qs: { access_token: PAGE_ACCESS_TOKEN },
//         method: 'POST',
//         json: messageData

//     }, function (error, response, body) {
//         if (!error && response.statusCode == 200) {
//             var recipientId = body.recipient_id;
//             var messageId = body.message_id;

//             console.log("Successfully sent generic message with id %s to recipient %s",
//                 messageId, recipientId);
//         } else {
//             console.error("Unable to send message.");
//             console.error(response);
//             console.error(error);
//         }
//     });
// }

var wit = new Wit({accessToken: WIT_TOKEN, actions: actions});