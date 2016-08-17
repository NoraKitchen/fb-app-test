var config = require('config');
var https = require('https');

// BBB api token 
const API_TOKEN = config.get('token');


////////////////////////////////////////////////////////////////////////////////////////////
// BBB.org API
function makeLink(query, cb) {
    var reqLink = '';
    if (query.name) reqLink += '&PrimaryOrganizationName=' + query.name;
    if (query.city) reqLink += '&City=' + query.city;
    if (query.state) reqLink += '&StateProvince=' + query.state;
    if (query.category) reqLink += "&PrimaryCategory=" + query.category;
    if (query.zip) reqLink += '&PostalCode=' + query.zip;


     return findBusiness(reqLink, cb);

    // findBusiness(reqLink, function (somedata) {
    //     if (somedata == "NoData") {
    //         console.log("no data")
    //         // return false;
    //         //   sendTextMessage(query.userId,"Sorry no data for this request")
    //     } else {
    //         // return somedata;
    //         //   showListOfBusiness(query.userId, somedata);
    //         console.log(somedata);
    //     }

    // });
};

function findBusiness(reqLink, callback) {

    var options = {
        host: 'api.bbb.org',
        port: 443,
        path: '/api/orgs/search?PageSize=10' + reqLink,
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.13) Gecko/20080311 Firefox/2.0.0.13',
            'Authorization': API_TOKEN
        }
    };

    var request = https.request(options, function (response) {
        console.log('Status: ' + response.statusCode);
        response.setEncoding('utf8');
        var body = "";
        response.on('data', function (chunk) { body += chunk });

        response.on("end", function () {

            console.log(body);
            //TotalResults: 0, SearchResults: [];

            var nodes = JSON.parse(body);

            //somehow seems to make it here, can log
            //but to nothing below
            //also even if made it to below, no search results

            if (nodes.TotalResults) {
                console.log("Total Results: " + nodes.TotalResults);
            }
            if (nodes.SearchResults) {
                callback(nodes.SearchResults);
            } else {
                console.log("got no data on response")
                callback(false);
            }
        });
    });

    request.on('error', function (error) {
        console.log('problem with request: ' + error.message);
    });

    request.end();
};



module.exports = {
    makeLink: makeLink
}