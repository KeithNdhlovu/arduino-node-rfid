
var express     = require('express');
var fs          = require('fs');
var firebase    = require('firebase');
var Promise     = require('promise');
var NodeGeocoder= require('node-geocoder');

var serveStatic = require('serve-static');

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

    self.options = {
        provider: 'google',
        // Optional depending on the providers 
        httpAdapter: 'https',
        apiKey: 'AIzaSyBtDR5p9DzzNBmMkBuavS6iOkoWndb99zs',
        formatter: null
    };

    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        self.ipaddress = process.env.IP;
        self.port      = process.env.PORT || 5000;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No HEROKU_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        self.routes['/v1/test'] = function(req, res) {
            res.setHeader('Content-Type', 'application/json');
            response = {
                domain: 'my-arduino-node-js',
                author: 'keith.io',
                tagID: req.query.tagID,
                result: 'ping success'
            };
            res.end(JSON.stringify(response));
        };       

        self.routes['/v2/access'] = function(req, res) {
            res.setHeader('Content-Type', 'application/json');

            if (typeof req.query.tagID === "undefined") {
                response = {
                    result: 'error'
                };
                res.end(JSON.stringify(response));
                return;
            }
            
            response = {
                tagID: req.query.tagID.trim()
            };

            self.checkUserAccess(response).then(function(success){
                res.end(JSON.stringify(success));
                return;
            }, function(err){
                res.end(JSON.stringify(err));
                return;
            });
        };

        self.routes['/v1/track'] = function (req, res) {

            if (typeof req.query.longitude === "undefined" || 
               typeof req.query.latitude  === "undefined" ||
               typeof req.query.cellphone === "undefined") {
                
                response = {
                    result: 'fail'
                };
                res.end(JSON.stringify(response));
                return;
            }
           
            // Prepare output in JSON format
            response = {
               latitude:req.query.latitude,
               longitude:req.query.longitude,
               cellphone:req.query.cellphone
            };

            self.createNewLocation(response).then(function(success){
                res.end(JSON.stringify(success));
                return;
            }, function(err){
                res.end(JSON.stringify(err));
                return;
            });
        };

    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.initializeFirebase();
        self.createRoutes();
        self.app    = express();
        
        //Application settings
        self.app.set('views', './views');
        self.app.set('view engine', 'ejs');
        
        self.app.get('/', function (req, res) {
            res.render('pages/index');
        });

        //After Services
        self.app.use(serveStatic('public'));

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }
    };

    /**
     *  Initialize firebase
     */
    self.initializeFirebase = function() {
        firebase.initializeApp({
          databaseURL: 'https://arduino-rfid-access-control.firebaseio.com/',
          serviceAccount: 'firebase-details.json'
        });

        self.otherApp = firebase.initializeApp({
          databaseURL: 'https://arduino-item-locator.firebaseio.com',
          serviceAccount: 'other-firebase-details.json'
        }, "other");


        console.log(firebase.app().name);  // "[DEFAULT]"
        console.log(self.otherApp.name);   // "other"
    }

    /**
     *  Check if a user request is allowed, by checking the user access list of a device
     */
    self.checkUserAccess = function(response) {
        return new Promise(function(resolve, reject){
            var ref = firebase.database().ref('/users');

            // Find user by their scanned card number
            ref.orderByChild("cardNumber")
                .equalTo(response.tagID)
                .on('value', function(snap) {
                    // if the results are empty, we return failiure
                    if(snap.val() == null)  return resolve({result:'fail'});

                    // Continue normal if, all is okay
                    snap.forEach(function(userSnapshot) { 
                        var userKey = userSnapshot.key;
                        var userData = userSnapshot.val();

                        // Grant access, and create an access log
                        var logsRef = firebase.database().ref('/logs');
                        var logRef = logsRef.push();
                        
                        // @TODO: Check card expiry date before you can allow access

                        logRef.update({ 
                            user: userData.fullname,
                            userID: userKey,
                            createdAt: firebase.database.ServerValue.TIMESTAMP
                        });

                        return true;
                    });
                        

                    resolve({result:'ok'});
                });
        });
    }

    /**
     *  Check if a user request is allowed, by checking the user access list of a device
     */
    self.createNewLocation = function(response) {
        
        return new Promise(function(resolve, reject) {

            var geocoder = NodeGeocoder(self.options);

            var ref = self.otherApp.database().ref('/users');
            var escape = false;
            
            //check which device is linked to cellphone
            var query = ref.orderByKey();
            query.once("value").then(function(snapshot) {

                snapshot.forEach(function(childSnapshot) {
                    var userKey = childSnapshot.key;
                    var userData = childSnapshot.val();
                    var deviceData = childSnapshot.child("device");

                    deviceData.forEach(function(deviceChildSnapshot) {
                        
                        var device = deviceChildSnapshot.val();
                        var deviceKey = deviceChildSnapshot.key;

                        console.log(device.cellphone);
                        console.log(response.cellphone);

                        if(device.cellphone === response.cellphone) {
                            //Save the new location data
                            var locationsRef = self.otherApp.database().ref('/users/'+ userKey +'/device/'+ deviceKey +'/locations');
                            var locationRef = locationsRef.push();


                            console.log(response);
                            // Using callback 
                            geocoder.reverse({lat:response.latitude, lon:response.longitude}, function(err, res) {
                                
                                if(err) return reject(err);
                                
                                var address = res[0];
                                
                                //Using data from geocoder since its more accurate
                                locationRef.update({ 
                                    latitude: address.latitude, 
                                    longitude: address.longitude,
                                    formattedAddress: address.formattedAddress,
                                    createdAt: firebase.database.ServerValue.TIMESTAMP
                                })
                                .then(function() {
                                    return ref.once("value");
                                });
                            });

                            //Add a listener to catch error messages and success messages
                            locationsRef.on('child_added', function(dataSnapshot) {
                                console.log('New Location data added');
                            }, function(error) {
                                console.log('Failed to add "child_added" listener /locations node:', error);
                            });
                            escape = true;
                            
                            resolve('ok');
                            //cancel further iterations
                            return escape;
                        }
                    });

                    reject('fail');
                    return escape;
                });
            });

        });
    }

    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();