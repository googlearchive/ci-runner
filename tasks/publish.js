module.exports = function publish(grunt) {
  grunt.config.merge({
    shell: {
      publishPages: {
        command: [
          'git commit --all -m "Published via \\`bower publish\\`."',
          'git push origin gh-pages',
        ].join('&&'),
        options: {
          execOptions: {
            cwd: 'gh-pages',
          },
        },
      },
      publishMain: {
        command: [
          'git commit --all -m "Published via \\`bower publish\\`."',
          'git push origin master',
        ].join('&&'),
      },
    },
  });
  grunt.registerTask('publish', ['shell:publishPages', 'shell:publishMain']);
};
