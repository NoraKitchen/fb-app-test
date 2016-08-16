var config = require('config');
var fetch = require('node-fetch');
require("./wit-helpers");

//The Wit actions object must include all functions you want to be able to directly call during the conversation
//It also must include a 'send' function that takes in the request (user id, context, and what they said) sends back the response formulated by Wit

var actions = {
    send(request, response) {
        //in fb exaple had diff (args), think will work this way...

        // const {sessionId, context, entities} = request;
        // const {text, quickreplies} = response;
        var recipientId = sessions[request.sessionId].fbid;
        if (recipientId) {
            console.log("sending response")
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
        if (context.POSSIBLEBUSINESSNAME) {
            //If a Wit has stored and confirmed a possible business name, default to using this
            //May refactor 'resolve possible business/location code to one function later
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
        // context.city = "<detectedCity>"; //for testing
        // context.state = "<detectedState>"; //for testing

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
        //If a Wit has stored and confirmed a possible business name, default to using this
        //May refactor 'resolve possible business/location code to one function later
        if (context.POSSIBLELOCATION) {
            var rawLocation = context.POSSIBLELOCATION;
            delete context.POSSIBLELOCATION;
        } else {
            var zip = firstEntityValue(entities, "number")
            var rawLocation = firstEntityValue(entities, "location")
        }

        if (!zip && !rawLocation) {
            var otherEntityValue = checkOtherEntities(entities);

            //**REFACTOR: can probably make this whole block (and similar block in business) part of checkOtherEntities
            if (otherEntityValue) {
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
        console.log("Searching BBB API.")

        var query = new SearchPoint;
        query.name = context.businessName;
        query.category = context.category;
        query.city = context.city;
        query.state = context.state;
        query.zip = context.zip;

        bbb.makeLink(query, function (searchResults) {
            console.log("TEST: Results sent to wit: " + searchResults);

            //for testing, later will display through fb messenger, not wit text
            for (var i = 0; i < searchResults.length; i++) {
                console.log(searchResults[i]["Address"])
            }

            if (searchResults) {
                context.results = "TEST: First Result Address: " + searchResults[0]["Address"];
            } else {
                context.noMatches = true;
            }
            return Promise.resolve(context);
        });
    },
    restartSession({context}) {
        context.endSession = true;
        return Promise.resolve(context);
    },
    confirmUseCurrentLocation({context, entities}) {
        //process answer to whether user wants to use current location data or not
        console.log("Confirming y/n answer to use current location")
        var answer = firstEntityValue(entities, "yes_no");
        console.log("Answer: " + answer)
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


//leaving this here for now. wit needs to call it but really belongs more with FB code 
var PAGE_ACCESS_TOKEN = config.get("pageAccessToken");
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


module.exports = {
    actions: actions
}