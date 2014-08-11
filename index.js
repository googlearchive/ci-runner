
var Firebase = require('firebase');
var git = require('gift');
var GitHubApi = require('github');
var async = require('async');
var path = require('path');
var shelljs = require('shelljs');
var request = require('request');

shelljs.rm('-rf', 'commits');

var testsInProgress = {};
var fbChangeQueue = new Firebase('https://ci-runner.firebaseio.com/queue');
var fbChangeStatus = new Firebase('https://ci-runner.firebaseio.com/status');

var github = new GitHubApi({
  version: "3.0.0",
  timeout: 5000
});

var GITHUB_OAUTH_TOKEN = process.env.GITHUB_OAUTH_TOKEN;
var SAUCE_USERNAME = process.env.SAUCE_USERNAME;
var SAUCE_ACCESS_KEY = process.env.SAUCE_ACCESS_KEY;

github.authenticate({
  type: 'oauth',
  token: GITHUB_OAUTH_TOKEN
});

fbChangeQueue.on('child_added', function(s) {
  testCommit(s.val(), s.ref());
});

function exec(cmd, args, cwd, exitCB, dataCB, errCB) {
  var spawn = require('child_process').spawn;
  var child = spawn(cmd, args, {cwd: cwd});
  var resp = '';
  if (dataCB) {
    child.stdout.on('data', function (buffer) {
      if (dataCB === true) {
        console.log(buffer.toString());
      } else {
        dataCB(buffer.toString());
      }
    });
  }
  if (errCB) {
    child.stderr.on('data', function (buffer) {
      if (errCB === true) {
        console.error(buffer.toString());
      } else {
        errCB(buffer.toString());
      }
    });
  }
  if (exitCB) {
    child.on('exit', function(code, signal) {
      exitCB(code);
    });
    child.on('error', function() {
      exitCB(-1);
    });
  }
}

function testCommit(event, fbRef) {
  var commit = event.pull_request.head;
  if (testsInProgress[commit.sha]) {
    return;
  }
  var user = event.repository.owner.login;
  var repoName = event.repository.name;
  var commitId = user + '|' + repoName + "|" + commit.sha;
  var repoPath = path.join('commits', user + '-' + repoName + "-" + commit.sha);
  var statusUrl = 'http://kevinpschaaf.github.io/ci-runner/?commit=' + commitId;
  var repo;
  var state;
  var statusMsg;
  var totalTests = 0;
  var passedTests = 0;
  var failedTests = 0;
  testsInProgress[commit.sha] = true;
  async.series([
    function(next) {
      console.log('Setting status to "pending" for ' + commit.sha);
      fbChangeStatus.child(commitId).remove();
      fbChangeStatus.child(commitId).child('pending').set(true);
      github.statuses.create({
        user: user,
        repo: repoName,
        sha: commit.sha,
        state: 'pending',
        description: 'Initializing tests...',
        target_url: statusUrl
      }, function(err) {
        next(err);
      });
    },
    function(next) {
      console.log('Clone:', commit.repo.clone_url);
      git.clone(commit.repo.clone_url, repoPath, function(err, _repo) {
        repo = _repo;
        next(err);
      });
    },
    function(next) {
      console.log('Checkout:', commit.sha);
      repo.checkout(commit.sha, function(err) {
        next(err);
      });
    },
    function(next) {
      console.log('Starting test on ' + commit.sha);
      var lastStatus = {};
      console.log('Starting npm install');
      exec('npm', ['install'], repoPath, function(code) {
        console.log('Completed npm install with code ' + code);
        if (code === 0) {
          github.statuses.create({
            user: user,
            repo: repoName,
            sha: commit.sha,
            state: 'pending',
            description: 'Starting tests...',
            target_url: statusUrl
          });
          exec('grunt', [], repoPath, function(code) {
            console.log('Completed grunt with code ' + code);
            if (code === 0) {
              state = 'success';
              statusMsg = passedTests + '/' + totalTests + ' platforms passed.';
            } else {
              state = 'failure';
              statusMsg = failedTests + '/' + totalTests + ' platforms failed.';
            }
            next();
          }, function(data) {
            var match;
            if (match = data.match('(\\d*) tests started')) {
              totalTests = parseInt(match[1]);
              fbChangeStatus.child(commitId).child('total').set(totalTests);
            }
            if (match = data.match('Platform: (.*)')) {
              lastStatus.platform = match[1];
            }
            if (match = data.match('Passed: (.*)')) {
              lastStatus.passed = (match[1] == 'true');
              if (lastStatus.passed) {
                passedTests++;
                fbChangeStatus.child(commitId).child('passed').set(passedTests);
              } else {
                failedTests++;
                fbChangeStatus.child(commitId).child('failed').set(failedTests);
              }
            }
            if (match = data.match('Url (.*)')) {
              lastStatus.url = match[1];
              console.log(lastStatus);
              var fbStatus = fbChangeStatus.child(commitId).child('platforms').push(lastStatus);
              var jobId = (match = lastStatus.url.match('jobs/(.*)')) && match[1];
              updateWithLog(fbStatus, jobId);
              github.statuses.create({
                user: user,
                repo: repoName,
                sha: commit.sha,
                state: 'pending',
                description: 'Testing platforms: ' + passedTests + ' passed, ' + failedTests + ' failed, ' + (totalTests - passedTests - failedTests) + ' remaining...',
                target_url: statusUrl
              });
            }
          });
        } else {
          next('npm install failed');
        }
      });
    },
    function(next) {
      console.log('Setting status to ' + state + ' for ' + commit.sha);
      github.statuses.create({
        user: user,
        repo: repoName,
        sha: commit.sha,
        state: state,
        description: statusMsg,
        target_url: statusUrl
      }, function(err) {
        next(err);
      });
    },
  ], function(err) {
    fbChangeStatus.child(commitId).child('pending').set(false);
    testsInProgress[commit.sha] = false;
    shelljs.rm('-rf', repoPath);
    if (err) {
      console.error(err);
      fbChangeStatus.child(commitId).child('error').set(err.toString());
      github.statuses.create({
        user: user,
        repo: repoName,
        sha: commit.sha,
        state: 'error',
        description: 'Error occurred: ' + err
      });
    } else {
      fbRef.remove();
    }
  });
}

function urlForSauceResource(resource) {
  return 'https://' + SAUCE_USERNAME + ':' + SAUCE_ACCESS_KEY + '@saucelabs.com/rest/v1/' + SAUCE_USERNAME + resource;
}

function updateWithLog(fbStatus, jobId) {
  var url = urlForSauceResource('/jobs/' + jobId + '/assets/log.json');
  request.get(url, function(err, resp, body) {
    if (!err && resp.statusCode == 200) {
      var log;
      try {
        log = JSON.parse(body);
      } catch (e) {
        console.error('Invalid log JSON: ' + url, e);
        console.error(body);
        return;
      }
      console.log('Storing log for ' + jobId);
      fbStatus.child('log').set(body);
      for (var i=0; i<log.length; i++) {
        var s = log[i];
        if (s.result && s.result.reports) {
          fbStatus.child('reports').set(s.result.reports);
          if (s.screenshot) {
            var n = ('0000' + s.screenshot).slice(-4);
            url = urlForSauceResource('/jobs/' + jobId + '/assets/' + n + 'screenshot.png');
            console.log('Retrieving image for ' + jobId);
            request.get({url:url, encoding:null}, function(err, resp, body) {
              if (!err && resp.statusCode == 200) {
                var data = "data:image/png;base64," + new Buffer(body).toString('base64');
                console.log('Storing image for ' + jobId);
                fbStatus.child('image').set(data);
              } else {
                console.error('Error retrieving image: ' + url + ': ' + err);
              }
            });
          }
          return;
        }
      }
    } else {
      console.error('Error retrieving log: ' + url + ': ' + err);
    }
  });
}

// var test = new Firebase('https://ci-runner.firebaseio.com/status/PolymerLabs-sauce-element-441a7b2bec399ec6c5b1c3b55531f125a7a086b2/-JU2tPns1mYVr8lXn1Dd');
// updateWithLog(test, '657f7d10fceb4e4aaa68de9dc0cfb536');