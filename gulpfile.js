/*
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

var gulp  = require('gulp');
var shell = require('gulp-shell');

gulp.task('bower', function() {
  return require('gulp-bower')('client/components');
});

gulp.task('vulcanize', ['bower'], function() {
  return gulp.src('client/index.html')
      .pipe(require('gulp-vulcanize')({
        dest:   'gh-pages',
        csp:    true,
        inline: true,
        strip:  true,
      }))
      .pipe(gulp.dest('gh-pages'));
});

gulp.task('publish', ['vulcanize'], shell.task([
  'cd gh-pages && git commit --all -m "Published via \\`bower publish\\`." && git push origin gh-pages',
  'git commit --all -m "Published via \\`bower publish\\`." && git push origin master',
]));

gulp.task
