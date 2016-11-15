
var express     = require('express');
var fs          = require('fs');
var firebase    = require('firebase');
var Promise     = require('promise');

var Server      = require('http');
var io          = require('socket.io');

var serveStatic = require('serve-static');

// serial port initialization:
var serialport = require('serialport'),			// include the serialport library
	SerialPort  = serialport.SerialPort,			// make a local instance of serial
	portName = '/dev/cu.usbmodem1421',								// get the port name from the command line
	portConfig = {
		baudRate: 9600,
		// call myPort.on('data') when a newline is received:
		parser: serialport.parsers.readline('\n')
	};

// Empty value to send when a user connects to the socket
var sendData = "";

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

        self.routes['/v2/test'] = function(req, res) {
            res.setHeader('Content-Type', 'application/json');
            response = {
                domain: 'my-arduino-node-js',
                author: 'keith.io',
                tagID: req.query.tagID,
                result: 'ping success'
            };
            res.end(JSON.stringify(response));
        };

        self.routes['/v2/read-card'] = function(req, res) {    
            res.setHeader('Content-Type', 'application/json');
            response = {
                result: 'hey'
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

        self.accesSerialPort();
        self.initSocketIO();
        
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
     * 
     * Initialize socket IO
     */
    self.initSocketIO = function() {
        
        self.server = Server.createServer(self.app);
        self.io = io.listen(self.server);

        self.io.on('connection', function (socket) {
            console.log("user connected");
            
            socket.emit('onconnection', {cardID:sendData});

            self.io.on('update', function(data) {
                socket.emit('readCard',{cardID:data});
            });
        });
    }

    /**
     *  Initialize firebase
     */
    self.initializeFirebase = function() {
        firebase.initializeApp({
          databaseURL: 'https://arduino-gprs.firebaseio.com/',
          serviceAccount: 'firebase-details.json'
        });
    }

    /**
     *  Check if a user request is allowed, by checking the user access list of a device
     */
    self.checkUserAccess = function(response) {
        return new Promise(function(resolve, reject){
            var ref = firebase.database().ref('/users');
            var found = false;
            var hasLogged = false;

            var query = ref.orderByKey();
            query.once("value")
                .then(function(snapshot) {
                    snapshot.forEach(function(childSnapshot) {
                        if(!found) {
                            // Get the user object
                            var userKey = childSnapshot.key;
                            var userData = childSnapshot.val();

                            // Get the device for this user
                            var deviceData = childSnapshot.child("device");

                            // Check the devices' access list for a user cellphone
                            deviceData.forEach(function(deviceChildSnapshot) {
                                var device = deviceChildSnapshot.val();
                                var deviceKey = deviceChildSnapshot.key;
                                
                                // Loop trough the 
                                var accessData = deviceChildSnapshot.child("access");

                                accessData.forEach(function(accessChildSnapshot) {
                                    var access = accessChildSnapshot.val();
                                    if(access.cellphone === response.cellphone) {
                                        //Grant access since they were added
                                        found = true;
                                        console.log('User is in access list');
                                        //Create a new access log
                                        var logsRef = firebase.database().ref('/users/'+ userKey +'/device/'+ deviceKey +'/logs');
                                        var logRef = logsRef.push();

                                        logRef.update({ 
                                            user: access.fullname,
                                            cellphone: access.cellphone,
                                            createdAt: firebase.database.ServerValue.TIMESTAMP
                                        });

                                        //Update the status of the door
                                        var deviceRef = firebase.database().ref('/users/'+ userKey +'/device/'+ deviceKey);
                                        deviceRef.update({
                                            opened: true,
                                            lastOpenTime: firebase.database.ServerValue.TIMESTAMP
                                        });
                                        //cancel further iterations
                                        resolve({result:'ok'});
                                        return found;
                                    }
                                });
                            });
                        }
                    });

                    if(!found) resolve({result:'fail'});
            });
        });
    }

    /**
     * Open serial port to read incoming data from RFID Reader
     *  
     */
    self.accesSerialPort = function () {
        // Open up serial com port
        self.myPort = new SerialPort(portName, portConfig); // open the serial port:        
        self.myPort.on('open', openPort);		// called when the serial port opens
        self.myPort.on('close', closePort);		// called when the serial port closes
        self.myPort.on('error', serialError);	// called when there's an error with the serial port
        self.myPort.on('data', listen);			// called when there's new incoming serial data

        function openPort() {
            console.log('port open');
            console.log('baud rate: ' + self.myPort.options.baudRate);
        }

        function closePort() {
            console.log('port closed');
        }

        function serialError(error) {
            console.log('there was an error with the serial port: ' + error);
            self.myPort.close();
        }

        function listen(data) {
            self.io.emit('update', data);
        }
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