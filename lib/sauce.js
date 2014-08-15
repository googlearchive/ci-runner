'use strict';

// Temporary holding place for our old sauce log parsing code until we have need
// for it again.

// function urlForSauceResource(resource) {
//   return 'https://' + SAUCE_USERNAME + ':' + SAUCE_ACCESS_KEY + '@saucelabs.com/rest/v1/' + SAUCE_USERNAME + resource;
// }

// function updateWithLog(log, fbStatus, jobId) {
//   var url = urlForSauceResource('/jobs/' + jobId + '/assets/log.json');
//   request.get(url, function(err, resp, body) {
//     log.info('got sauce log', body);
//     if (!err && resp.statusCode == 200) {
//       var payload;
//       try {
//         payload = JSON.parse(body);
//       } catch (e) {
//         log.error('Invalid log JSON: ' + url, e);
//         log.error(body);
//         return;
//       }
//       log.info('Storing log for ' + jobId);
//       fbStatus.child('log').set(body);
//       for (var i=0; i<log.length; i++) {
//         var s = payload[i];
//         if (s.result && s.result.reports) {
//           fbStatus.child('reports').set(s.result.reports);
//           if (s.screenshot) {
//             var n = ('0000' + s.screenshot).slice(-4);
//             url = urlForSauceResource('/jobs/' + jobId + '/assets/' + n + 'screenshot.png');
//             log.info('Retrieving image for ' + jobId);
//             request.get({url:url, encoding:null}, function(err, resp, body) {
//               if (!err && resp.statusCode == 200) {
//                 var data = "data:image/png;base64," + new Buffer(body).toString('base64');
//                 log.info('Storing image for ' + jobId);
//                 fbStatus.child('image').set(data);
//               } else {
//                 log.error('Error retrieving image: ' + url + ': ' + err);
//               }
//             });
//           }
//           return;
//         }
//       }
//     } else {
//       log.error('Error retrieving log: ' + url + ': ' + err);
//     }
//   });
// }
