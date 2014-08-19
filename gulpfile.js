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
