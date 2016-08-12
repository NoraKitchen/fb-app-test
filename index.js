var express = require('express');
var bodyParser = require('body-parser');
var request = require('request');
var fetch = require('node-fetch');
var config = require('config');
var parser = require('parse-address')
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

//This code attempts to pull entity values/variables for use in functions/actions below
function firstEntityValue(entities, entity) {
    var val = entities && entities[entity] &&
        Array.isArray(entities[entity]) &&
        entities[entity].length > 0 &&
        entities[entity][0].value
        ;
    if (!val) {
        return null;
    }
    return typeof val === 'object' ? val.value : val;
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
                .then(function () {
                    return null;
                }) //.catch here 
            // return new Promise(function (resolve, reject) {
            //     console.log('user said...', request.text);
            //     console.log('sending...', JSON.stringify(response));
            //     return resolve();
            // });
        }
    },
    collectBusinessName({context, entities}) {
        //the structure of entities is a little odd. firstEntityValue digs into it and pulls out the actual text value we want 
        //no longer called business_name.....location??? local_search_query?
        console.log(entities);
        var businessName = firstEntityValue(entities, "local_search_query");

        if (businessName) {
            context.businessName = businessName;
            console.log("Captured business name " + context.businessName);
            if (context.missingName) {
                delete context.missingName;
            }
        } else {
            //wit frequently does not pick up the business name correctly and logs it as another entity
            //check if any other entities have been collected and save them as a possible business name
            //will then check with user if it is correct
            console.log("No business name found. Checking for other entities collected by Wit.")
            var possibleBusinessNames = [];
            for (var entity in entities) {
                var currentEntityValue = firstEntityValue(entities, entity);
                possibleBusinessNames.push(currentEntityValue);
            };

            if (possibleBusinessNames.length === 1){
                console.log("One other entity found. Suggesting as possible business name.")
                context.possibleBusinessName = possibleBusinessNames[0];
            } else {
                //either no other entities were found, or multiple other entites were found
                console.log("no other entities found, or multi entities. business name capture failed.")
                context.missingName = true;
            }


        
        // } else if (possibleBusinessName) {
        //     console.log("Captured a 'location' instead of BN. Double check.")
        //     context.possibleBusinessName = possibleBusinessName;
        // } else {
        //     console.log("Capture of business name unsuccessful.")
        //     context.missingName = true;
        }
        return Promise.resolve(context);
    },
    detectLocation({context, entities}) {
        console.log("Attempting to auto-detect location.")
        //here would attempt to detect user location automatically
        //when retrieved, it would add the location to context
        context.city = "<detectedCity>"; //for testing
        context.state = "<detectedState>"; //for testing

        if (context.city && context.state) {
            console.log("City and state identified.")
            context.displayLocation = context.city + ", " + context.state
            delete context.locationNotFound;
        } else {
            console.log("Unable to auto-detect location.")
            context.locationNotFound = true;
        }
        return Promise.resolve(context);
    },
    // collectCityState({context, entities}) {
    //     console.log("City and State recieved.")
    //     console.log(entities);
    //     //wit auto-detects when the user types a location pretty well, but it does not parse into city/state very well
    //     //In the event parsing to city/state does work (or I am able to train it better later), this function will collect the values
    //     var city = firstEntityValue(entities, "city");
    //     var state = firstEntityValue(entities, "state");

    //     if (city && state) {
    //         context.city = city;
    //         context.state = state;
    //         context.location = city + ", " + state; //location stored for display in chatbox
    //         delete context.locationNotFound;
    //         context.locationFound = true;
    //     //at this point, values for business name, city, and state have been collected
    //     //ready to search BBB API
    //     }
    //     else {
    //         context.locationNotFound = true;
    //     }
    //     return Promise.resolve(context);
    // },
    collectLocation({context, entities}) {
        console.log("Location string accepted.")
        console.log(entities);
        //getting a null location----probably stored in yes/no

        var zip = firstEntityValue(entities, "number")
        var rawLocation = firstEntityValue(entities, "location")
        console.log("Location recieved: " + rawLocation + ", checking input type.")
        //check if location recieved was a zip
        if (zip) {
            console.log("Location is zip. Storing zip.")
            context.zip = zip;
            context.displayLocation = zip;

            //at this point, values for business name and zip have been collected
            //ready to search BBB API
        }
        else if (rawLocation) {
            //the location collected from the user input was not a zip.
            //likely it is a city/state combo wit failed to parse and took as a whole ("Boise, Idaho 83709", "Newport, OR", etc.)

            //check here the string contains a space or comma--ensure city AND state entered
            //if user enters a city with a space in the name ("san francisco"), it will unfortuantely pass this test, but will likely ultimately still fail the parse, which is good
            if (rawLocation.indexOf(" ") >= 0 || rawLocation.indexOf(",") >= 0) {
                console.log("Parsing location into city and state.")
                //the address parser requires a street address to work reliably, hence the placeholder
                var placeholder = "111 Placeholder "
                var parsedLocation = parser.parseLocation(placeholder + rawLocation);
                console.log(parsedLocation);

                var city = parsedLocation.city;
                var state = parsedLocation.state;
                var zip = parsedLocation.zip; //zip may end up here if user listed city/state with it


                if (!city && !state && !zip) {
                    console.log("Address parse returned nothing.")
                    context.locationNotFound = true;
                } else if (zip) {
                    //zip is parsed more reliably so default to using that if present
                    console.log("Zip found.")
                    context.zip = zip;
                    context.displayLocation = zip; //location stored for dispay in chatbox
                    delete context.locationNotFound;
                } else if (city && state) {
                    console.log("City and state found.")
                    context.city = city;
                    context.state = state;
                    context.displayLocation = city + ", " + state;
                    delete context.locationNotFound;
                } else {
                    //only a city or only a state was found. don't bother accepting the information.
                    context.locationNotFound = true;
                }
            } else {
                //location did not contain a space or comma, so is likely incomplete
                console.log("Location incomplete.")
                context.locationNotFound = true;
            }
        } else {
            //no location found in input
            console.log("Neither zip number nor location string extracted.")
            context.locationNotFound = true;
        }
        return Promise.resolve(context);
    },
    executeSearch({context, entities}) {
        //pull the zip or city and state off the context
        //and run a search with the BBB API
        console.log("Searching BBB API.")

        var searchResults = true; //just here for testing, assume we got some results

        if (searchResults) {
            delete context.noMatches;
            context.results = "<search results>"; //the real search results go here
        } else {
            context.noMatches = true;
        }
        return Promise.resolve(context);
    },
    restartSession({context}) {
        context.endSession = true;
        return Promise.resolve(context);
    },
    confirmUseCurrentLocation({context, entities}) {
        //process answer to whether user wants to use current location data or not
        console.log("confirming y/n to use current location")
        var answer = firstEntityValue(entities, "yes_no");
        if (answer === "Yes") {
            delete context.retry;
            delete context.doNotUseCL;
            context.useCL = true;
        }
        else if (answer === "No") {
            delete context.retry;
            delete context.useCL;
            delete context.city;
            delete context.state;
            delete context.displayLocation;
            context.doNotUseCL = true;
        }
        else {
            context.retry = true;
        }
        return Promise.resolve(context);
    },
    confirmBusinessName({context, entities}) {
        //confirm collected business name right
        console.log("confirming y/n business name collected is correct")
        var answer = firstEntityValue(entities, "yes_no");

        if (answer === "Yes") {
            delete context.businessNameWrong;
            delete context.retry;
            context.businessNameConfirmed = true;
        } else if (answer === "No") {
            delete context.businessNameConfirmed;
            delete context.retry;
            context.businessNameWrong = true;
        } else {
            context.retry = true;
        }
        return Promise.resolve(context);
    },
    setBusinessName({context, entities}) {
        context.businessName = context.possibleBusinessName;
        delete context.possibleBusinessName;
        return Promise.resolve(context);
    }
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
                            if (sessions[sessionId].context.endSession) {
                                //search returned no results, ending session to restart search
                                console.log("restarting session")
                                delete sessions[sessionId];
                            } else if (context.results) {
                                //code to display results here, possibly buttons to restart search or display more
                                //for now I am auto-deleting session/search till we have buttons to restart
                                console.log("restarting session")
                                delete sessions[sessionId];
                            }

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


function sendFbMessage(id, text) {
    var body = JSON.stringify({
        //upt in quotes, dunno if ness
        recipient: { "id": id },
        message: { "text": text },
    });
    //uses fetch instead of request like below
    var qs = 'access_token=' + encodeURIComponent(PAGE_ACCESS_TOKEN);
    return fetch('https://graph.facebook.com/me/messages?' + qs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

var wit = new Wit({ accessToken: WIT_TOKEN, actions: actions });