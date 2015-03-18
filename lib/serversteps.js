/*
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
'use strict';

var _            = require('lodash');
var express      = require('express');
var GHWebHooks   = require('github-webhook-handler');
var sauceConnect = require('sauce-connect-launcher');
var uuid         = require('uuid');

var Commit = require('./commit');

// Services

function establishSauceTunnel(config, done) {
  config.sauce.tunnelIdentifier = uuid.v4();
  sauceConnect(config.sauce, function(error, tunnel) {
    if (!error) {
      console.log('  Sauce tunnel established. Tunnel id:', config.sauce.tunnelIdentifier);
    }
    done(error);
  });
}

// Web Server

function startServer(config, queue, done) {
  console.log('\nStarting Webserver');

  var app = express();

  // "Middleware"

  app.use(function(req, res, next){
    console.log('%s %s', req.method, req.url);
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

  // GitHub Hooks

  hooks.on('push', function(event) {
    console.log('Received GitHub push event:', event);

    var payload = event.payload;
    var commit;
    try {
      commit = Commit.forPushEvent(payload);
    } catch (error) {
      console.log('Malformed push event:', error, '\n', payload);
      return;
    }

    if (!_.contains(config.worker.pushBranches, commit.branch)) {
      console.log('Skipping push event ("' + commit.branch + '" not a whitelisted branch)');
      return;
    }

    queue.add(commit);
  });

  hooks.on('pull_request', function(event) {
    console.log('Received GitHub pull_request event:', event);
    var payload = event.payload;
    if (payload.action !== 'opened' && payload.action !== 'synchronize') return;

    var commit;
    try {
      commit = Commit.forPullRequestEvent(payload);
    } catch (error) {
      console.log('Malformed push event:', error, '\n', payload);
      return;
    }
    queue.add(commit);
  });

  // Boot

  app.listen(config.worker.port);

  console.log('Webserver listening for requests');
  done();
}

module.exports = {
  establishSauceTunnel: establishSauceTunnel,
  startServer:          startServer,
};
