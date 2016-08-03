var express = require('express');
var server = express();
var port = process.env.PORT || 8080; //process is note obj, looks if user has port? was in heroku notes
var bodyParser = require('body-parser');
var  request = require('request');

server.use(bodyParser.json());


server.listen(port, function () { console.log("server running on port " + port) });

// server.get('/test', function(req, res){
//     res.sendFile(__dirname + "/public/index.html");
// })
//dirname says use current directory path

server.use('/test', express.static(__dirname + '/public'))

var VALIDATION_TOKEN = "verifyMe";
var PAGE_ACCESS_TOKEN = "EAAMVFy1iwHkBAHzZCPDi4d3PsmxJGqFImF5onKk7iPHAsdswU56elnAhewsajEDRh6FWiBfM6pYZAp7vriKe7WVM61a5DS2pfIyR6nvzHuFojzFyC10RlB1jFgjHp3ZA42oZCLpR8twJkzcm3s6H2CPwc9IXX3NiBtZBFZBgJ3wwZDZD";

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
                    console.log(messagingEvent.message.text);
                    console.log(messagingEvent.sender.id);

                    var messageData = {
                        recipient: {
                            id: messagingEvent.sender.id
                        },
                        message: {
                            text: messagingEvent.message.text
                        }
                    }
                    callSendApi(messageData);

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



function callSendApi(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s", 
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });  
}