var config = require('config');
var helpers = require('./wit-helpers');
var bbb = require('../bbbapi');
var fbm = require('../fb-message')


// SEARCHING OBJECT CONSTUCTOR FROM SERGEY
function SearchPoint() {
    this.name = false;
    this.category = false;
    this.city = false;
    this.state = false;
    this.zip = false;
    this.userId = false;
}

//The Wit actions object - must in include all functions you may call during the conversation
//As well as the 'send' function that says what happens whenever Wit sends a message
var actions = {
    send(request, response) {
        //Original example set up below.
        // var recipientId = sessions[request.sessionId].fbid;
        //currently using FBID instead ---look closer later to see if this cause problems?
        var recipientId = request.sessionId;

        //helpers later ----didn't keep updates
        // if (request.entities.find_by_name_request) {
        //     request.context.findByName = true;
        // } else if (request.entities.find_by_category_request){
        //     request.context.findbyCategory = true;
        // }

        // if (request.context.newContext) {
        //     //very icky way of circumventing wit to display results since context not updating after BBB API call
        //     //the context gets sent back to FB before this, so...
        //     //once you change this, change 'newSession' code to stop using newContext
        //     request.context = request.context.newContext;
        //     response.text = request.context.results
        // }

        if (recipientId) {
            console.log(request.context);
            return fbm.sendFbMessage(recipientId, response.text)
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
    collectNameOrCat({context, entities}) {
        var collectingValue = context.findByCategory ? "category" : "businessName";

        if (context["POSSIBLE" + collectingValue.toUpperCase()]) {
            var lsq = context["POSSIBLE" + collectingValue.toUpperCase()];
            delete context["POSSIBLE" + collectingValue.toUpperCase()];
            delete context[collectingValue.toUpperCase() +  "CONFIRMED"];
        } else {
            var lsq = helpers.firstEntityValue(entities, "local_search_query");
        }

        if (lsq) {
            context[collectingValue] = lsq;
            context.hasNameOrCategory = true;
            delete context.MISSINGBUSINESSNAME;
            delete context.MISSINGCATEGORY;
            delete context[collectingValue + "WRONG"];
        } else {
            var otherEntityValue = helpers.checkOtherEntities(entities);

            if (otherEntityValue) {
                context["POSSIBLE" + collectingValue.toUpperCase()] = otherEntityValue;
            } else {
                context["MISSING" + collectingValue.toUpperCase()] = true;
            }
        }
        return Promise.resolve(context);

        ///////


        // if (context.POSSIBLEBUSINESSNAME) {
        //     var businessName = context.POSSIBLEBUSINESSNAME;
        //     delete context.POSSIBLEBUSINESSNAME;
        // } else {
        //     var businessName = helpers.firstEntityValue(entities, "local_search_query");
        // }

        // if (businessName) {
        //     context.businessName = businessName;
        //     context.hasNameOrCategory = true;
        //     console.log("Captured business name " + context.businessName);
        //     if (context.MISSINGBUSINESSNAME) {
        //         delete context.MISSINGBUSINESSNAME;
        //     }
        // } else {
        //     var otherEntityValue = helpers.checkOtherEntities(entities);

        //     if (otherEntityValue) {
        //         context.POSSIBLEBUSINESSNAME = otherEntityValue;
        //     } else {
        //         context.MISSINGBUSINESSNAME = true;
        //     //     }
        // }
        //     return Promise.resolve(context);
    },
    detectLocation({context, entities}) {
        console.log("Attempting to auto-detect location.")
        //here would attempt to detect user location automatically
        //when retrieved, it would add the location to context

        //pretending these values were returned for testing purposes
        // context.detectedCity = "<detectedCity>"; //for testing
        // context.detectedState = "<detectedState>"; //for testing

        if (context.detectedCity && context.detectedState) {
            console.log("City and state identified.")
            delete context.locationNotFound;
        } else {
            console.log("Unable to auto-detect location.")
            context.locationNotFound = true;
        }
        return Promise.resolve(context);
    },
    collectLocation({context, entities}) {
        console.log("collecting location")
        console.log("entities for collect location")
        console.log(entities)
        console.log(context)

        if (context.POSSIBLELOCATION) {
            var rawLocation = context.POSSIBLELOCATION;
            delete context.POSSIBLELOCATION;
        } else {
            var zip = helpers.firstEntityValue(entities, "number")
            var rawLocation = helpers.firstEntityValue(entities, "location")
        }

        if (!zip && !rawLocation) {
            var otherEntityValue = helpers.checkOtherEntities(entities);

            //**REFACTOR: can probably make this whole block (and similar block in business) part of checkOtherEntities
            if (otherEntityValue) {
                context.POSSIBLELOCATION = otherEntityValue;
                delete context.locationNotFound;
            } else {
                context.locationNotFound = true;
            }

        } else if (zip) {
            console.log("Location is zip. Zip collected as location.")
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
        query.userId = context.uid;

        bbb.makeLink(query);
        context.endSession = true;
        // return Promise.resolve({
        //     //Icky way of returning data back to send/promise....look into better later?
        //     businessName: context.businessName,
        //     displayLocation: context.displayLocation,
        //     newContext: context,
        //     resultsPlaceholder: bbb.makeLink(query, function(searchResults){
        //         console.log("TEST: Results sent to wit: " + searchResults);

        //         //for testing, later will display through fb messenger, not wit text
        //         for (var i = 0; i < searchResults.length; i++){
        //             console.log(searchResults[i]["Address"])
        //         }

        //         if (searchResults){
        //             context.results = "TEST: First Result Address: " + searchResults[0]["Address"];
        //         } else {
        //             context.results = "Sorry, I couldn't find anything for " +context.businessName+ " in " +context.displayLocation + "."
        //         }
        //         return context;
        //     })
        // })
        return Promise.resolve(context);
    },
    // restartSession({context}) {
    //     context.endSession = true;
    //     return Promise.resolve(context);
    // },
    confirmUseCurrentLocation({context, entities}) {
        //process answer to whether user wants to use current location data or not
        //can probably refactor to use yes/no helper function or buttons
        var answer = helpers.firstEntityValue(entities, "yes_no");
        console.log("Answer: " + answer)
        if (answer === "Yes") {
            delete context.retry;
            delete context.doNotUseCL;
            context.city = contxt.detectedCity;
            context.state = context.detectedState;
            context.displayLocation = context.city + ", " + context.state;
            context.useCL = true;
        }
        else if (answer === "No") {
            delete context.retry;
            delete context.useCL;
            delete context.detectedCity;
            delete context.detectedState;
            context.doNotUseCL = true;
        }
        else {
            context.retry = true;
        }
        return Promise.resolve(context);
    },
    confirmBusinessNameOrCategory({context, entities}) {
        var confirmingValue = context.findByCategory ? "CATEGORY" : "BUSINESSNAME";
        var answer = helpers.firstEntityValue(entities, "yes_no");
        helpers.confirmYesNo(context, answer, confirmingValue);
        return Promise.resolve(context);
    },
    confirmLocation({context, entities}) {
        var answer = helpers.firstEntityValue(entities, "yes_no");
        helpers.confirmYesNo(context, answer, "LOCATION");
        return Promise.resolve(context);
    },
};


module.exports = {
    actions: actions
}