'use strict';

var _      = require('underscore');
var domain = require('domain');

var Commit     = require('./commit');
var TestRunner = require('./testrunner');

function Queue(processor, fbQueue, workerId, concurrency, jitter, itemTimeout) {
  this._processor   = processor;
  this._fbQueue     = fbQueue;
  this._workerId    = workerId;
  this._concurrency = concurrency;
  this._jitter      = jitter;
  this._itemTimeout = itemTimeout;

  this._active = [];

  this._fbQueue.on('value', function(snapshot) {
    this._itemsSnapshot = snapshot;
    this._withJitter(this._pluck);
  }.bind(this));
}

Queue.prototype.add = function add(commit) {
  console.log('Adding', commit, 'to the queue');
  // Note that there is potential for dupes; but it should be rare, and isn't
  // the end of the world when it occurs. We just run the same tests again.
  this._fbQueue.push(_.pick(commit, 'user', 'repo', 'sha', 'branch'));
};

Queue.prototype._pluck = function _pluck() {
  if (!this._itemsSnapshot || !this._claimNextItem(this._itemsSnapshot.val())) return;
  if (this._active.length >= this._concurrency) return;
  if (this._plucking) return;

  console.log('Inspecting the remote queue for something to claim');
  this._plucking = true;
  var commit;
  this._itemsSnapshot.ref().transaction(function(items) {
    commit = this._claimNextItem(items);
    if (commit) console.log('Attempting pluck for', commit);
    return items;

  }.bind(this), function(error, committed, snapshot) {
    console.log('Pluck attempt complete', committed, error);
    this._plucking = false;
    if (!commit) return; // Nothing to pluck.

    if (error || !committed) {
      console.log('Pluck failed for', commit, 'committed:', committed, 'error:', error);
    } else {
      this._process(commit);
    }

    // Regardless, we want to keep trying (to fill our queue, or try again).
    if (commit) {
      this._withJitter(this._pluck);
    }
  }.bind(this));
};

Queue.prototype._claimNextItem = function _claimNextItem(items, dryRun) {
  if (!items) return;
  var keys = Object.keys(items);
  for (var i = 0, item; item = items[keys[i]]; i++) {
    if (item.activeWorker && ((item.activeAt || 0) + this._itemTimeout) > Date.now() ) continue;
    if (!dryRun) {
      item.activeWorker = this._workerId;
      item.activeAt     = Date.now();
    }
    var commit = new Commit(item.user, item.repo, item.sha, item.branch);
    commit._queueKey = keys[i];
    return commit;
  }
};

Queue.prototype._withJitter = function _withJitter(callback) {
  // https://github.com/joyent/node/issues/8065
  var delay = Math.round((Math.random() / 2 + 0.5) * this._jitter);
  setTimeout(callback.bind(this), delay);
};

Queue.prototype._process = function _process(commit) {
  console.log('Processing', commit);
  this._active.push(commit);
  this._processor(commit, function(error) {
    // We leave failed tasks on the queue, but don't touch them so that they
    // aren't picked up til the timeout.
    this._cleanup(commit, !error);
  }.bind(this));
};

Queue.prototype._cleanup = function _cleanup(commit, removeQueueItem) {
  console.log('Cleaning up', commit);
  this._active = _.without(this._active, commit);
  if (removeQueueItem) {
    this._fbQueue.child(commit._queueKey).remove();
  }
  this._pluck();
};

module.exports = Queue;
