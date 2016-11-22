
var express     = require('express');
var fs          = require('fs');
var firebase    = require('firebase');
var Promise     = require('promise');

var Server      = require('http');
var io          = require('socket.io');

var serveStatic = require('serve-static');

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
    }

    /**
     *  Check if a user request is allowed, by checking the user access list of a device
     */
    self.checkUserAccess = function(response) {
        return new Promise(function(resolve, reject){
            var ref = firebase.database().ref('/users');

            // Find user by their scanned card number
            ref.startAt(response.tagID)
                .endAt(response.tagID)
                .once('value', function(snap) {
                    var userKey = snap.key;
                    var userData = snap.val();
                    // Grant access, and create an access log
                    var logsRef = firebase.database().ref('/logs');
                    var logRef = logsRef.push();
                    
                    // @TODO: Check card expiry date before you can allow access

                    logRef.update({ 
                        user: userData.fullname,
                        userID: userKey,
                        createdAt: firebase.database.ServerValue.TIMESTAMP
                    });

                    console.log('found user matching tagID', snap.fullname());
                    resolve({result:'ok'});
                }).catch(function(err) {
                    console.log('unable to find user matching the query');
                    resolve({result:'fail'});
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
        self.server.listen(self.port, function() {
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