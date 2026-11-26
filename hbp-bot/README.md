# HBP 제작봇

`#수다방`에서 `/hbp 1화`를 입력하면 영상 한 편에 필요한 자료와 담당자를 모은 카드를 만듭니다. 같은 명령을 다시 실행하면 기존 카드를 엽니다.

팀에 사용법을 보여주려면 `#수다방`에 **사용법**을 한 단어로 보내세요. 같은 스레드에서 입력하면 스레드에 답합니다. 혼자 보려면 **/hbp 사용법**을 입력하세요.

## Slack에 연결하기

Node.js 24 이상이 필요합니다. 별도로 설치할 패키지는 없습니다.

1. [Slack 앱 관리](https://api.slack.com/apps)에서 **Create New App → From a manifest**를 선택하고 HBP 워크스페이스에 이 폴더의 `manifest.json` 내용을 입력합니다.
2. **Install App → Install to Workspace**에서 설치한 뒤 **OAuth & Permissions**의 Bot User OAuth Token을 확인합니다. **Basic Information → App-Level Tokens**에서 `connections:write` 권한으로 앱 토큰을 만듭니다.
3. 이 폴더에서 `cp -n .env.example .env`를 실행합니다. 로컬 `.env`에 `SLACK_APP_TOKEN`(xapp)과 `SLACK_BOT_TOKEN`(xoxb)을 넣습니다. 두 토큰은 같은 앱에서 발급합니다. HBP 채널 ID는 예시 파일에 채워 두었습니다.
4. `#수다방`에 **HBP 제작봇**을 초대하고 `npm start`를 실행합니다. Socket Mode가 연결되면 채널에서 `/hbp 1화`를 사용합니다. 상시 알림을 받으려면 네트워크가 연결된 호스트에서 이 프로세스 한 개를 계속 실행합니다.

Slack과의 연결은 발신 WebSocket을 사용합니다. 앱의 봇은 `commands`, `chat:write`, `channels:history` 권한을 사용합니다. `message.channels` 이벤트에서 지정된 제작 채널의 `사용법` 메시지를 확인하며 대화 내용을 저장하지 않습니다. [Slack Socket Mode 가이드](https://docs.slack.dev/apis/events-api/using-socket-mode/)

## 1화를 인계하는 순서

1. 회차를 만들 때 자료 담당, BGM 담당, 편집자를 역할마다 한 명 이상 고릅니다. 같은 사람이 여러 역할을 맡을 수 있습니다. 이미지 목표는 기본 35장이며 마감은 선택입니다. 입력 시간은 한국시간입니다.
2. 해당 역할의 담당자라면 누구나 원본 메시지의 **⋯ → 회차 자료로 등록**을 선택합니다. 회차와 자료 종류를 고르면 메시지 링크가 등록됩니다. 다른 링크를 입력해 직접 등록하거나 카드에서 **자료 등록**을 눌러도 됩니다. 공유할 자료와 목적지를 선택한 뒤 등록을 누릅니다.
3. 이미지 묶음은 장수를 함께 입력합니다. 10장씩 세 묶음과 5장 한 묶음을 연결하면 총 35장이 됩니다. 같은 링크를 두 번 등록해도 같은 장수가 다시 더해지지 않습니다. 카드의 **전체 자료**에서 이전 묶음도 열 수 있습니다.
4. 편집자는 등록된 자료를 열어 보고 항목별 **수신 확인**을 누릅니다. 편집자 한 명이 확인하면 모두의 카드에 확인됨으로 표시됩니다. 그 종류에 새 링크가 추가되면 다시 확인할 수 있습니다. 목소리 샘플과 BGM은 별도 항목입니다. 편집 초안은 편집자가 등록합니다.
5. 대본·목표 장수만큼의 이미지·요약 자막·BGM이 모두 제출되면 지정된 편집자 각자에게 카드 링크를 보냅니다. 마감을 지정하면 아직 자료가 부족한 담당자에게 미제출 항목을 묶어 한 번 알립니다. 알림은 1분 간격으로 확인합니다.

## 운영과 검증

- 카드, 자료 링크, 수신 확인 및 알림 전송 기록은 `DB_PATH`의 SQLite 파일에 저장됩니다. 재시작할 때 같은 데이터를 사용합니다.
- 메시지 바로가기는 회차 카드 채널과 설정된 자료 채널에서 사용합니다. 다른 워크스페이스에서 운영할 때는 `.env`의 채널 ID를 변경합니다.
- `npm test`는 로컬 임시 데이터와 모의 Slack 요청으로 실행됩니다. 실제 워크스페이스 설치 후에는 테스트용 회차로 카드 게시와 DM 수신을 확인할 수 있습니다.

## 맥이 꺼져도 봇이 동작하게 하기 (클라우드 배포)

두 봇은 맥이 아닌 클라우드에서 실행합니다. 배포 후에는 맥에서 `npm start`를 실행하지 않습니다. 같은 토큰으로 두 곳에서 동시에 실행하면 이벤트가 나뉘어 처리됩니다.

### HBP 제작봇 → GitHub Actions (무료)

저장소 최상위의 `.github/workflows/hbp-bot.yml`이 봇을 약 5시간 40분씩 실행하고, 대기 중인 다음 실행이 곧바로 이어받습니다. 매시간 예약 실행이 대기열을 채우므로 교대 시 공백은 보통 1분 안쪽이며, 그 사이의 명령은 다시 입력하면 됩니다. 회차 데이터는 `HBP_DB_KEY`로 암호화해 Actions 캐시에 보관합니다.

1. **공개(Public) 저장소**에 푸시합니다. 비공개 저장소는 무료 사용량(월 2,000분)을 며칠 만에 넘기므로 공개 저장소로 운영합니다. 토큰은 secret으로만 보관되고 `.env`와 `data/`는 올라가지 않습니다.
2. **Settings → Secrets and variables → Actions**에 다음을 저장합니다.
   - `HBP_SLACK_APP_TOKEN`: HBP 제작봇의 xapp 토큰
   - `HBP_SLACK_BOT_TOKEN`: HBP 제작봇의 xoxb 토큰
   - `HBP_DB_KEY`: 데이터 암호화용 임의 문자열(`openssl rand -base64 32`로 생성). 바꾸면 이전 데이터를 읽을 수 없습니다.
3. **Actions → HBP 제작봇 → Run workflow**로 첫 실행을 시작하고, 로그에 `Slack Socket Mode 연결됨`이 보이면 맥에서 실행 중인 봇을 끕니다.
4. 맥의 기존 데이터를 이어 쓰려면 첫 실행 전에 알려 주세요. 처음 실행하면 빈 데이터로 시작합니다.

주의: 공개 저장소에 60일 동안 커밋이 없으면 GitHub이 예약 실행을 멈춥니다. 또한 GitHub Actions는 상시 서버 용도로 설계된 서비스가 아니므로, 정책이 바뀌거나 실행이 지연되면 아래의 서버 배포로 옮깁니다.

### HBP 제작봇 → Fly.io (유료 대안, 상시 실행)

Socket Mode는 프로세스가 계속 떠 있어야 하므로 항상 켜져 있는 서버가 필요합니다. 설정은 `Dockerfile`과 `fly.toml`에 있으며, SQLite 데이터는 `/data` 볼륨에 저장됩니다.

```sh
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config      # 앱 이름이 이미 있으면 fly.toml의 app 값을 바꿉니다
fly volumes create hbp_data --region nrt --size 1
fly secrets set SLACK_APP_TOKEN=xapp-... SLACK_BOT_TOKEN=xoxb-... \
  HOME_CHANNEL_ID=C0CM8RSN9LY SCRIPT_CHANNEL_ID=C0CLE9BSHD0 IMAGE_CHANNEL_ID=C0CL9EUCUFM \
  MUSIC_CHANNEL_ID=C0CKZB3FU8P DRAFT_CHANNEL_ID=C0CLCG0C63Y
fly deploy
fly logs                                  # "Slack Socket Mode 연결됨"이 보이면 완료
```

- 맥에 쌓인 데이터를 옮기려면 `fly ssh sftp shell`로 `data/hbp.sqlite`를 `/data/hbp.sqlite`에 올린 뒤 `fly machine restart`를 실행합니다.
- 프로세스가 종료되면 Fly가 자동으로 다시 시작합니다. 머신은 한 대만 유지합니다(`fly scale count 1`).
- Docker를 실행할 수 있는 다른 서버(Railway, 개인 VPS 등)에서도 같은 `Dockerfile`을 사용할 수 있습니다. 이때는 `/data`를 영구 볼륨으로 연결합니다.

### 아이디어봇

아이디어봇은 이 저장소 최상위 폴더에 있으며 `영상 아이디어` 워크플로로 예약 실행됩니다.
