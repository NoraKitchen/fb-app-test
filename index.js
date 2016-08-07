var express = require('express');
var server = express();
var port = process.env.PORT || 8080; //process is note obj, looks if user has port? was in heroku notes
var bodyParser = require('body-parser');
var request = require('request');
var fetch = require('node-fetch');

server.use(bodyParser.json());


server.listen(port, function () { console.log("server running on port " + port) });

// server.get('/test', function(req, res){
//     res.sendFile(__dirname + "/public/index.html");
// })
//dirname says use current directory path

// server.use('/test', express.static(__dirname + '/public'))

//*
var Wit = null;
let log = null;
try {
    // if running from repo
    Wit = require('../').Wit;
} catch (e) {
    Wit = require('node-wit').Wit;
}

// var WIT_TOKEN = process.env.WIT_TOKEN;
var WIT_TOKEN = "KY2YTSDBZKPRRVG5TF4GKHFGPXJ2WP2G";


// This will contain all user sessions.
// Each session has an entry:
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
    echoLocation({context, entities}) {
        context.location = entities.location;
        return Promise.resolve(context);
    },
    longTime({context, entities}) {
        context.years = Math.random() * (100 - 2) + 2;
        return Promise.resolve(context);
    },
};


//*



var VALIDATION_TOKEN = "verifyMe";
var PAGE_ACCESS_TOKEN = "EAAMVFy1iwHkBAKtF4gZBezhyeZAdHZCgUdfwwBPwiKkGG3bTQ7cgY9JN7wZAPqfie7VEGs5tURss4qnfDhTzDXcCD7Wve3BlyZBubOYXidORWq0bQEIJpv2ZAlH8gf9JOqMe1WGh7gynBaYZB03AkCrkSUmYCvNo031ODYrmp0nHQZDZD";
// var PAGE_ACCESS_TOKEN = process.env.WIT_TOKEN;

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
                        wit.runActions(sessionId, senderText, sessions[sessionId].context
                        ).then(function (context) {
                            console.log("actions run complete")
                            sessions[sessionId].context = context;
                            //now bot is waiting for futher emssages?
                            //based on session state/business logic, might delete session here
                            //if (context['done']){delete sessions[sessionId]}
                        })
                    }

                    //this code moved to callSendApi
                    // var messageData = {
                    //     recipient: {
                    //         id: messagingEvent.sender.id
                    //     },
                    //     message: {
                    //         text: messagingEvent.message.text + ", or so they say."
                    //     }
                    // }
                    // callSendApi(messageData);

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

var wit= new Wit({accessToken: WIT_TOKEN, actions: actions});