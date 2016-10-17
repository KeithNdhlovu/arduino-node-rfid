
var express     = require('express');
var fs          = require('fs');
var firebase    = require('firebase');


/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;

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

        self.routes['/asciimo'] = function(req, res) {
            var link = "http://i.imgur.com/kmbjB.png";
            res.send("<html><body><img src='" + link + "'></body></html>");
        };

        self.routes['/'] = function(req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('index.html') );
        };

        self.routes['/v2/test'] = function(req, res) {
            res.setHeader('Content-Type', 'application/json');
            response = {
                domain: 'my-arduino-node-js',
                author: 'keith.io',
                cellphone: req.query.cellphone,
                result: 'ping success'
            };
            res.end(JSON.stringify(response));
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


            self.addNewLocation(response);
            res.end('ok');
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.initializeFirebase();
        self.createRoutes();
        self.app = express();

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
          databaseURL: 'https://arduino-item-locator.firebaseio.com',
          serviceAccount: 'firebase-details.json'
        });
    }

    /**
     * 
     */
    self.addNewLocation = function(response) {
  
        var ref = firebase.database().ref('/users');
        var escape = false;
        //check which device is linked to cellphone
        var query = ref.orderByKey();
        query.once("value")
          .then(function(snapshot) {
            snapshot.forEach(function(childSnapshot) {
                var userKey = childSnapshot.key;
                var userData = childSnapshot.val();
                var deviceData = childSnapshot.child("device");
                

                deviceData.forEach(function(deviceChildSnapshot) {
                    var device = deviceChildSnapshot.val();
                    var deviceKey = deviceChildSnapshot.key;
                    if(device.cellphone === response.cellphone) {
                        //Save the new location data
                        var locationsRef = firebase.database().ref('/users/'+ userKey +'/device/'+ deviceKey +'/locations');
                        var locationRef = locationsRef.push();

                        //Add a listener to catch error messages and success messages
                        locationsRef.on('child_added', function(dataSnapshot) {
                          console.log('New Location data added');
                        }, function(error) {
                          console.log('Failed to add "child_added" listener /locations node:', error);
                        });
                        escape = true;
                        //cancel further iterations
                        return escape;
                    }
                });

                return escape;
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