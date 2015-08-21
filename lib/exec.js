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

var spawn       = require('child_process').spawn;
var LinerStream = require('linerstream');

var STUCK_COMMAND_SIGINT_DELAY  = 10 * 60000; // 10 minutes.
var STUCK_COMMAND_SIGKILL_DELAY = 11 * 60000; // 11 minutes.

function exec(log, cmd, args, spawnArgs, callback) {
  if (String(spawnArgs) === spawnArgs) {
    var cwd = spawnArgs;
    spawnArgs = {
      cwd: cwd
    };
  }
  var child = spawn(cmd, args, spawnArgs);
  log.group.apply(log, ['running command:', cmd].concat(args));

  child.stdout.pipe(new LinerStream()).on('data', log.info.bind(log));
  child.stderr.pipe(new LinerStream()).on('data', log.error.bind(log));

  var ended = false;
  function done(error) {
    if (ended) return;
    ended = true;
    log.groupEnd();
    callback(error);
  }

  child.on('exit', function(code, signal) {
    log.info('exit status:', signal || code);
    done(code === 0 ? null : code);
  });
  child.on('error', function(error) {
    log.error('error', error);
    done(error);
  });

  setTimeout(function() {
    if (ended) return;
    child.kill('SIGINT');
  }, STUCK_COMMAND_SIGINT_DELAY);

  setTimeout(function() {
    if (ended) return;
    done('process timed out');
    child.kill('SIGKILL');
  }, STUCK_COMMAND_SIGKILL_DELAY);
}

module.exports = exec;
