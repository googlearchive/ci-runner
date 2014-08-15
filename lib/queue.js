'use strict';

var _ = require('underscore');

var Commit = require('./commit');

function Queue(fbQueue, workerId, concurrency, jitter, itemTimeout) {
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
  // Note that there is potential for dupes; but it should be rare, and isn't
  // the end of the world when it occurs. We just run the same tests again.
  this._fbQueue.push(_.pick(commit, 'user', 'repo', 'sha'));
};

Queue.prototype._pluck = function _pluck() {
  if (!this._itemsSnapshot || !this._claimNextItem(this._itemsSnapshot.val())) return;
  if (this._active.length >= this._concurrency) return;
  if (this._plucking) return;
  this._plucking = true;

  var commit;
  this._itemsSnapshot.ref().transaction(function(items) {
    commit = this._claimNextItem(items);
    console.log('Attempting pluck for', commit);
    return items;
  }.bind(this), function(error, committed, snapshot) {
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
  var keys = Object.keys(items);
  for (var i = 0, item; item = items[keys[i]]; i++) {
    if (item.activeWorker && ((item.activeAt || 0) + this._itemTimeout) > Date.now() ) continue;
    if (!dryRun) {
      item.activeWorker = this._workerId;
      item.activeAt     = Date.now();
    }
    return new Commit(item.user, item.repo, item.sha);
  }
};

Queue.prototype._withJitter = function _withJitter(callback) {
  setTimeout(callback.bind(this), (Math.random() / 2 + 0.5) * this._jitter);
};

Queue.prototype._process = function _process(commit) {
  console.log('processing', commit);
  this._active.push(commit);
};

module.exports = Queue;
