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

var _            = require('lodash');
var cleankill    = require('cleankill');
var express      = require('express');
var GHWebHooks   = require('github-webhook-handler');
var sauceConnect = require('sauce-connect-launcher');
var url          = require('url');
var uuid         = require('uuid');

var Commit = require('./commit');

// Services

var sauceProcess;

function establishSauceTunnel(config, workerLog, done) {
  if (sauceProcess) {
    sauceProcess.close();
  }
  config.sauce.tunnelIdentifier = uuid.v4();
  sauceConnect(config.sauce, function(error, tunnel) {
    if (!error) {
      workerLog.info('Sauce tunnel established. Tunnel id:', config.sauce.tunnelIdentifier);
    }
    sauceProcess = tunnel;
    done(error);
  });
}

// Web Server

function startServer(config, workerLog, queue, fbRoot, github, done) {
  workerLog.info('Starting Webserver');

  var app = express();

  // "Middleware"

  app.use(function(req, res, next){
    if (req.url !== '/') {
      workerLog.info(req.method, req.url);
    }
    next();
  });

  var hooks = new GHWebHooks({
    path:   config.github.webhookPath,
    secret: config.github.webhookSecret,
  });
  app.use(hooks);

  // Routes

  app.get('/', function(req, res) {
    res.send('CI Runner: https://github.com/PolymerLabs/ci-runner');
  });

  function queryToCommit(query, log, callback) {
    var match = (query || '').match(/^([^@\/]+)\/([^@\/]+)(?:@(.+))?$/);
    var user  = match[1];
    var repo  = match[2];
    var ref   = match[3] || 'master';
    if (!user || !repo || !ref) {
      return callback('Invalid commit identifier. Expected USER/REPO[@REF]');
    }
    log('Looking up commit... ');
    github.repos.getCommit({user: user, repo: repo, sha: ref}, function(error, data) {
      if (error) {
        return callback(error);
      }
      callback(null, new Commit(user, repo, data.sha, ref));
    });
  }

  function enqueueCommit(query, done, log) {
    log = log || function() {};

    queryToCommit(query, log, function(error, commit) {
      if (error) {
        return done(error.message);
      } else {
        log('done');
      }

      log('\nEnqueuing request for ' + commit.short() + '... ');
      queue.add(commit, function(error) {
        if (error) {
          done(error.message);
        } else {
          log('done');
          done(null, commit);
        }
      });
    });
  }

  function cancelCommit(query, done, log) {
    log = log || function(){};

    queryToCommit(query, log, function(error, commit) {
      if (error) {
        return done(error.message);
      } else {
        log('done');
      }

      log('\nUnqueuing request for ' + commit.short() + '... ');
      queue.remove(commit, function(error) {
        if (error) {
          done(error.message);
        } else {
          log('done');
          done(null, commit);
        }
      });
    });
  }

  app.get('/test', function(req, res) {
    var query = url.parse(req.url).query || '';
    enqueueCommit(query, function(error) {
      if (error) {
        res.write('ERROR: ' + error);
      }
      res.end();
    }, res.write.bind(res));
  });

  app.get('/slack/test', function(req, res) {
    var query = url.parse(req.url, true).query.text || '';
    enqueueCommit(query, function(error, commit) {
      if (error) {
        res.write('ERROR: ' + error);
      } else {
        res.write('CI runner enqueued <' + commit.reportUrl + '|' + commit.short() + '>');
      }
      res.end();
    });
  });

  app.get('/cancel', function(req, res) {
    var query = url.parse(req.url).query || '';
    cancelCommit(query, function(error) {
      if (error) {
        res.write('ERROR: ' + error);
      }
      res.end();
    }, res.write.bind(res));
  });

  app.get('/slack/cancel', function(req, res) {
    var query = url.parse(req.url, true).query.text || '';
    cancelCommit(query, function(error, commit) {
      if (error) {
        res.write('ERROR: ' + error);
      } else {
        res.write('CI runner cancelled <' + commit.reportUrl + '|' + commit.short() + '>');
      }
      res.end();
    });
  });

  app.get('/slack/kill', function(req, res) {
    var query = url.parse(req.url, true).query || '';
    workerLog.warn('Got Kill Request: ' + JSON.stringify(query));
    console.log("Equal?", query.channel_id, config.slackChannelId, query.channel_id === config.worker.slackChannelId);
    if (query.channel_id === config.worker.slackChannelId) {
      res.write('CI runner is rebooting...');
      cleankill.interrupt(function(){
        if (sauceProcess) {
          sauceProcess.close();
        }
      });
    }
    res.end();
  });

  // GitHub Hooks

  hooks.on('push', function(event) {
    var payload = event.payload;
    var commit;
    try {
      commit = Commit.forPushEvent(payload);
    } catch (error) {
      workerLog.info('Malformed push event:', error, '\n', payload);
      return;
    }

    if (!_.contains(config.worker.pushBranches, commit.branch)) {
      workerLog.info('Skipping push event ("' + commit.branch + '" not a whitelisted branch)');
      return;
    }

    queue.add(commit);
  });

  hooks.on('pull_request', function(event) {
    var payload = event.payload;
    if (payload.action !== 'opened' && payload.action !== 'synchronize') return;

    var commit;
    try {
      commit = Commit.forPullRequestEvent(payload);
    } catch (error) {
      workerLog.info('Malformed push event:', error, '\n', payload);
      return;
    }
    queue.add(commit);
  });

  // Boot

  app.listen(config.worker.port);

  workerLog.info('Webserver listening for requests');
  done();
}

module.exports = {
  establishSauceTunnel: establishSauceTunnel,
  startServer:          startServer,
};
