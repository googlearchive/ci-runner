module.exports = function build(grunt) {
  grunt.registerTask('build', 'builds the client and checks it into gh-pages', [
    'bower:install',
    'vulcanize',
    'publish',
  ]);
};
