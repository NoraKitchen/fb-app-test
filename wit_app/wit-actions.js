var helpers = require('./wit-helpers');
var fetch = require('node-fetch');
var config = require('config');
var bbb = require('../bbbapi');

// SEARCHING OBJECT CONSTUCTOR FROM SERGEY
function SearchPoint() {
  this.name = false;
  this.category = false;
  this.city = false;
  this.state = false;
  this.zip = false;
//   this.userId = false;
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
        // var recipientId = sessions[request.sessionId].fbid;
        var recipientId = request.sessionId;

        if (request.context.newContext) {
            //very icky way of circumventing wit to display results since context not updating
            //the context gets sent back to FB before this, so...
            //once you change this, change 'newSession' code to stop useing newContext
            request.context = request.context.newContext;
            response.text = request.context.results
        }

        if (recipientId) {
            console.log(request.context);
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
            console.log("running first ent")
            var businessName = helpers.firstEntityValue(entities, "local_search_query");
        }

        if (businessName) {
            context.businessName = businessName;
            console.log("Captured business name " + context.businessName);
            if (context.missingName) {
                delete context.missingName;
            }
        } else {
            console.log("Unable to extract expected business name/local search query entity.")
            var otherEntityValue = helpers.checkOtherEntities(entities);

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
        console.log("Location string accepted.")
        console.log(entities);  //for testing

        if (context.POSSIBLELOCATION) {
            console.log("Resolving possible location to confirmed location.")
            var rawLocation = context.POSSIBLELOCATION;
            delete context.POSSIBLELOCATION;
        } else {
            var zip = helpers.firstEntityValue(entities, "number")
            var rawLocation = helpers.firstEntityValue(entities, "location")
        }

        if (!zip && !rawLocation) {
            //No location found in input
            console.log("Neither zip number nor location string extracted.")
            var otherEntityValue = helpers.checkOtherEntities(entities);

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

            var twoPartAddy = helpers.checkTwoPartAddy(rawLocation);

            if (twoPartAddy) {
                var parsedAddy = helpers.parseAddy(rawLocation);
                helpers.updateLocationContext(context, parsedAddy);
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

        return Promise.resolve({newContext: context, results: bbb.makeLink(query, function(searchResults){
        console.log("TEST: Results sent to wit: " + searchResults);

        //for testing, later will display through fb messenger, not wit text
        for (var i = 0; i < searchResults.length; i++){
            console.log(searchResults[i]["Address"])
        }

        if (searchResults){
            context.results = "TEST: First Result Address: " + searchResults[0]["Address"];
        } else {
            context.noMatches = true;
        }
        return context;
        })}
        )

    },
    restartSession({context}) {
        context.endSession = true;
        return Promise.resolve(context);
    },
    confirmUseCurrentLocation({context, entities}) {
        //process answer to whether user wants to use current location data or not
        console.log("Confirming y/n answer to use current location")
        var answer = helpers.firstEntityValue(entities, "yes_no");
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
        var answer = helpers.firstEntityValue(entities, "yes_no");

        helpers.confirmYesNo(context, answer, "BUSINESSNAME");

        return Promise.resolve(context);
    },
    confirmLocation({context, entities}) {
        //Confirm collected 'possible' location is correct.
        console.log("Confirming possible location collected is correct. Y/N")
        var answer = helpers.firstEntityValue(entities, "yes_no");

        helpers.confirmYesNo(context, answer, "LOCATION");

        return Promise.resolve(context);
    },
};


//Put this in another module later

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