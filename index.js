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

function firstEntityValue(entities, entity) {
    //Attempts to pull entity values/variables for use in functions/actions below
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

function checkOtherEntities(entities) {
    //Wit frequently categorizes entities incorrectly (e.g. files a business name under 'location')
    //This will check all other entities collected from the user input and store their values
    //If one single other entity/value is found, it is likey what the user intended.
    //The value is returned so we can check with the user what they meant by it.

    console.log("Expected entity not found in user input. Checking other entities for possible values.")
    var possibleValues = [];

    for (var entity in entities) {
        var currentEntityValue = firstEntityValue(entities, entity);
        possibleValues.push(currentEntityValue);
    };

    if (possibleValues.length === 1) {
        console.log("One other entity found. Returning as possible intended value.")
        console.log("poss value" + possibleValues[0]);
        // context.possibleBusinessName = possibleBusinessNames[0];
        return possibleValues[0];
    } else {
        //Either no other entities were found, or multiple other entites were found, making it difficult to determine what the user meant.
        console.log("No other entities found, or multi entities. Target entity capture failed.")
        return false;
        // context.missingName = true;
    }
}

function confirmYesNo(context, answer, confirmingValue) {
    //While in theory Wit should be able to react to yes/no answers from user, I could not get it to do so accurately
    //This function will help it respond to yes/no input more reliably
    //It is specifically for checking/confirming when Wit has probably not picked up/categorized user input correctly, and we want to double check we want to double check with the user
    if (answer === "Yes") {
        delete context[confirmingValue + "WRONG"];
        delete context.retry;
        context[confirmingValue + "CONFIRMED"] = true;
    } else if (answer === "No") {
        delete context[confirmingValue + "CONFIRMED"];
        delete context.retry;
        console.log("test log context for deleted possible")
        console.log(context);
        delete context["POSSIBLE" + confirmingValue];
        context[confirmingValue + "WRONG"] = true;
    } else {
        context.retry = true;
    }
}

function checkTwoPartAddy(locationString) {
    //Ensure city AND state entered by checking if location string contains a space or comma
    //If user enters a city with a space in the name ("san francisco") but no state, it will unfortuantely pass this test, but will likely ultimately still fail the parse further on, which is good
    if (locationString.indexOf(" ") >= 0 || locationString.indexOf(",") >= 0) {
        return true;
    } else {
        return false;
    }
}

function parseAddy(locationString) {
    //Takes in a location string ("Boise, ID", "Nampa ID 83709" and divides into city, state, zip.)
    console.log("Parsing location into city and state, or zip if applicable.")

    //The address parser requires a street address to work reliably, hence the placeholder.
    var placeholder = "111 Placeholder "

    var parsedLocation = parser.parseLocation(placeholder + locationString);
    return parsedLocation;
}

function updateLocationContext(context, parsedAddy) {
    //Updates the context with the parsed address object.
    //If address does not contain the necessary parts, tell with the location was not found.
    if (!parsedAddy.city && !parsedAddy.state && !parsedAddy.zip) {
        console.log("Address parse returned nothing.")
        context.locationNotFound = true;
    } else if (parsedAddy.zip) {
        //Zip is parsed more reliably so default to using that if present.
        console.log("Zip found.")
        context.zip = parsedAddy.zip;
        context.displayLocation = parsedAddy.zip; //Location stored for dispay in chatbox
        delete context.locationNotFound;
    } else if (parsedAddy.city && parsedAddy.state) {
        console.log("City and state found.")
        context.city = parsedAddy.city;
        context.state = parsedAddy.state;
        context.displayLocation = parsedAddy.city + ", " + parsedAddy.state;
        delete context.locationNotFound;
    } else {
        //Only a city or only a state was found. don't bother accepting the information.
        context.locationNotFound = true;
    }
}


//The Wit actions object - mustin include all functions you may call during the conversation
//as well as the 'send' function that says what happens whenever Wit formulates a reply and sends it back
//In this case we call sendFbMessage in the send method, in order to send the response to the facebook user indicated
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
        console.log(entities);

        if (context.POSSIBLEBUSINESSNAME) {
            console.log("Resolving possible business name to confirmed business name.")
            var businessName = context.POSSIBLEBUSINESSNAME;
            delete context.POSSIBLEBUSINESSNAME;
        } else {
            var businessName = firstEntityValue(entities, "local_search_query");
        }

        if (businessName) {
            context.businessName = businessName;
            console.log("Captured business name " + context.businessName);
            if (context.missingName) {
                delete context.missingName;
            }
        } else {
            console.log("Unable to extract expected business name/local search query entity.")
            var otherEntityValue = checkOtherEntities(entities);

            if (otherEntityValue) {
                context.POSSIBLEBUSINESSNAME = otherEntityValue;
            } else {
                context.missingName = true;
            }
        }
        return Promise.resolve(context);
    },
    detectLocation({context, entities}) {
        console.log("Attempting to auto-detect location.")
        //here would attempt to detect user location automatically
        //when retrieved, it would add the location to context

        //pretending these values were returned for testing purposes
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
    collectLocation({context, entities}) {
        console.log("Location string accepted.")
        console.log(entities);  //for testing

        if (context.POSSIBLELOCATION) {
            console.log("Resolving possible location to confirmed location.")
            var rawLocation = context.POSSIBLELOCATION;
            delete context.POSSIBLELOCATION;
        } else {
            var zip = firstEntityValue(entities, "number")
            var rawLocation = firstEntityValue(entities, "location")
        }

        if (!zip && !rawLocation) {
            //No location found in input
            console.log("Neither zip number nor location string extracted.")
            var otherEntityValue = checkOtherEntities(entities);

            if (otherEntityValue) {
                console.log("OTHER ENTITY SET AS POSSIBLE, SHOULD GO POSS ROUTE.")
                context.POSSIBLELOCATION = otherEntityValue;
                delete context.locationNotFound;
            } else {
                context.locationNotFound = true;
            }

        } else if (zip) {
            console.log("Location is zip. Storing zip.")
            context.zip = zip;
            context.displayLocation = zip;
            delete context.locationNotFound;
        } else if (rawLocation) {
            //The location collected from the user input was not a zip.
            //Likely it is a city/state combo wit failed to parse and took as a whole ("Boise, Idaho 83709", "Newport, OR", etc.)
            //Check if the address is the required two part address, if so parse it.
            //If the address contains the necessary parts (zip or city and state), update the context.

            var twoPartAddy = checkTwoPartAddy(rawLocation);

            if (twoPartAddy) {
                var parsedAddy = parseAddy(rawLocation);
                updateLocationContext(context, parsedAddy);
            } else {
                //location did not contain a space or comma, so is likely incomplete
                console.log("Location incomplete.")
                context.locationNotFound = true;
            }
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
        console.log("Confirming y/n answer to use current location")
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

        confirmYesNo(context, answer, "BUSINESSNAME");

        return Promise.resolve(context);
    },
    confirmLocation({context, entities}) {
        //Confirm collected 'possible' location is correct.
        console.log("Confirming possible location collected is correct. Y/N")
        var answer = firstEntityValue(entities, "yes_no");

        confirmYesNo(context, answer, "LOCATION");

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