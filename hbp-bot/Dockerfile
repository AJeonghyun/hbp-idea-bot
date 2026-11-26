# HBP 제작봇 — 맥 대신 클라우드 서버에서 24시간 실행하기 위한 이미지
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/hbp.sqlite
COPY package.json ./
COPY index.mjs slack.mjs store.mjs notifications.mjs ./
# SQLite 파일은 /data 볼륨에 저장되어 재배포·재시작 후에도 유지됩니다.
VOLUME ["/data"]
CMD ["node", "index.mjs"]
