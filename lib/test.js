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

var crypto = require('crypto');
var stacky = require('stacky');

function Test(fbTests, name) {
  this.name = name;

  this._fbRoot = fbTests;
  for (var i = 0; i < name.length - 1; i++) {
    this._fbRoot = this._testNode(this._fbRoot, name[i]).child('children');
  }
  this._fbRoot = this._testNode(this._fbRoot, name[name.length - 1]);

  this._values = {
    title:    name[name.length - 1],
    browsers: {},
  };
}

Test.prototype.updateState = function updateState(browser, state, error) {
  if (!this._values.browsers[browser.id]) {
    this._values.browsers[browser.id] = {};
  }
  this._values.browsers[browser.id].state = state;
  if (error) {
    this._values.browsers[browser.id].error = stacky.normalize(error);
  }

  this.save();
  return this;
};

Test.prototype.save = function save() {
  this._fbRoot.set(this._values);
};

Test.prototype._testNode = function _testNode(parent, title) {
  var node = parent.child(this._keyForTitle(title));
  node.child('title').set(title);
  return node;
};

Test.prototype._keyForTitle = function _keyForTitle(title) {
  var hash = crypto.createHash('sha1');
  hash.update(title);
  return hash.digest('hex');
};

module.exports = Test;
