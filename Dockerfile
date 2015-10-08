FROM google/nodejs

ADD server.sh /

WORKDIR /app
ADD package.json /app/
RUN npm install -g bower
RUN npm install --production
ADD . /app

CMD []
ENTRYPOINT ["/server.sh"]
