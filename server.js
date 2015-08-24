/*
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
// jshint node: true
'use strict';

var fs           = require('fs');
var async        = require('async');
var chalk        = require('chalk');
var Firebase     = require('firebase');
var GitHub       = require('github');
var htmlToText   = require('nodemailer-html-to-text').htmlToText;
var http         = require('http');
var mkdirp       = require('mkdirp');
var nodemailer   = require('nodemailer');
var path         = require('path');
var userid       = require('userid');

var Config       = require('./lib/config');
var Log          = require('./lib/log');
var protect      = require('./lib/protect');
var Queue        = require('./lib/queue');
var RepoRegistry = require('./lib/reporegistry');
var serverSteps  = require('./lib/serversteps');
var TestRunner   = require('./lib/testrunner');
// Setup & Global State

// We may not be in a real TTY, but we _really_ like colors.
chalk.enabled = true;
// We open a crap ton of concurrent requests to Sauce.
http.globalAgent.maxSockets = 250;

// CI Runner configuration.
var config = new Config(process.env);
// The root firebase key that CI runner state is maintained under.
var fbRoot = new Firebase(config.firebase.root);
// The task `Queue` that drives this server.
var queue;
// GitHub API.
var github = new GitHub({version: '3.0.0'});
github.authenticate({type: 'oauth', token: config.github.oauthToken});
// This worker's global log (events not related to tests).
var workerKey = config.worker.workerId.replace(/[.#$\[\]]/g, '-');
var workerLog = new Log(process.stdout, null, fbRoot.child('log').child(workerKey));
// Mailer
var mailer = nodemailer.createTransport(config.email.nodemailer);
mailer.use('compile', htmlToText());
mailer.use('compile', function(mail, done) {
  mail.data.from = config.email.sender;
  mail.data.bcc  = config.email.recipients;
  done();
});

var cacheDir;

// Workflow Segments

function setupCICache(done) {
  workerLog.group('Setting up CI cache');
  cacheDir = path.join(__dirname, 'ci_cache');
  workerLog.info('creating cache:', cacheDir);
  mkdirp(cacheDir, function(error) {
    workerLog.groupEnd();
    done(error);
  });
}

function connectToServices(done) {
  workerLog.group('Connecting to services');

  async.parallel([
    serverSteps.establishSauceTunnel.bind(serverSteps, config, workerLog),
    function(next) {
      fbRoot.authWithCustomToken(config.firebase.secret, function(error) {
        if (!error) {
          workerLog.info('Authenticated with Firebase');
        }
        next(error);
      });
    },
  ], function(error) {
    workerLog.groupEnd();
    done(error);
  });
}

function QueueProcessor(repos) {
  this.runner = null;
  this.repos = repos;
}

QueueProcessor.prototype.run = function run(commit, done) {
  var fbStatus = fbRoot.child('status').child(commit.key);
  var log      = new Log(process.stdout, commit, fbStatus.child('log'));
  this.runner  = new TestRunner(commit, fbStatus, github, this.repos, config, mailer, log);

  var fn = function(err, resp) {
    this.runner = null;
    done(err, resp);
  }.bind(this);

  protect(function() {
    this.runner.run(fn);
  }.bind(this), function(error) {
    log.fatal(error, 'CI runner internal error:');
    fn(error);
  });
};

QueueProcessor.prototype.cancel = function cancel(commit) {
  if (this.runner) {
    this.runner.cancel();
  }
};

function dropRoot(done) {
  if (process.getuid() === 0) {
    workerLog.group('Dropping from root');
    try {
      var nobodyUid = userid.uid('nobody');
      var nobodyGid = (function(groups) {
        var gid = -1;
        for (var i = 0; i < groups.length; i++) {
          try {
            gid = userid.gid(groups[i]);
            break;
          } catch(_) {
          }
        }
        return gid;
      })(['nobody', 'nogroup']);
      if (nobodyGid === -1) {
        return done('Could not get nobody credentials');
      }
      workerLog.info('resetting cache folder credntials to nobody');
      fs.chownSync(cacheDir, nobodyUid, nobodyGid);
      workerLog.info('setting bower cache locations');
      process.env.XDG_CACHE_HOME = path.join(cacheDir, 'cache');
      process.env.XDG_CONFIG_HOME = path.join(cacheDir, 'config');
      process.env.XDG_DATA_HOME = path.join(cacheDir, 'data');
      workerLog.info('UID root -> nobody');
      process.setuid(nobodyUid);
      workerLog.groupEnd();
      done();
    } catch(_) {
      done('Could not drop from root!');
    }
  } else {
    done();
  }
}

// TODO(nevir): This could use some cleanup.
function startQueue(done) {
  workerLog.info('Starting Queue');

  var repos = new RepoRegistry(path.join(cacheDir, 'commits'));

  queue = new Queue(new QueueProcessor(repos), fbRoot.child('queue'), github, config);
  queue.start();

  done();
}

// Boot
async.series([
  setupCICache,
  TestRunner.update.bind(TestRunner, config, workerLog, mailer),
  dropRoot,
  connectToServices,
  startQueue,
  function(done) {
    serverSteps.startServer(config, workerLog, queue, fbRoot, github, done);
  },
], function(error) {
  if (error) {
    workerLog.error('CI Runner failed to start:', error);
    throw error;
  }
  workerLog.info('CI Runner active.');
});

