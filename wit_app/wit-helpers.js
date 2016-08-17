var parser = require('parse-address');



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


module.exports = {
    firstEntityValue: firstEntityValue,
    checkOtherEntities: checkOtherEntities,
    checkTwoPartAddy: checkTwoPartAddy,
    confirmYesNo: confirmYesNo,
    parseAddy: parseAddy,
    updateLocationContext: updateLocationContext
};