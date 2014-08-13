module.exports = function vulcanize(grunt) {
  grunt.loadNpmTasks('grunt-vulcanize');
  grunt.config.merge({
    vulcanize: {
      default: {
        options: {
          csp:    true,
          inline: true,
          strip:  true,
        },
        files: {
          'gh-pages/index.html': 'index.html',
        },
      },
    },
  });
};
