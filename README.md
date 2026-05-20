# K-apt 입찰 검색앱

공공데이터포털 K-apt 입찰공고/입찰결과 API를 조회하는 웹앱입니다.

## 현재 구조

- 방문자는 API 인증키를 입력하지 않습니다.
- API 인증키는 서버 환경변수 `KAPT_SERVICE_KEY`에만 저장합니다.
- 별도 데이터베이스 없이 실시간 조회합니다.
- 같은 검색은 기본 15분 동안 서버 메모리에 임시 저장합니다.
- 과도한 호출을 막기 위해 기본 1분 60회 제한을 둡니다.

## 로컬 실행

`config.example.json`을 복사해 `config.local.json`을 만들고 인증키를 넣습니다.

```json
{
  "serviceKey": "공공데이터포털_Encoding_인증키"
}
```

Codex 번들 Node.js로 실행:

```powershell
C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.js
```

브라우저에서 열기:

```text
http://localhost:3100
```

## Render 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Render에서 New Web Service를 선택합니다.
3. 저장소를 연결합니다.
4. Start Command는 `node server.js`로 둡니다.
5. Environment Variables에 `KAPT_SERVICE_KEY`를 추가하고 공공데이터포털 인증키를 입력합니다.
6. 배포 후 생성된 주소로 접속합니다.

`render.yaml`을 사용하면 기본 설정을 자동으로 잡을 수 있습니다.

## 구현된 기능

- 검색어/아파트명/단지코드 기반 조회
- 입찰공고/입찰결과 선택
- 입찰종류/입찰방법/입찰상태 코드 조회
- 지역별 결과 분포
- 입찰종류/방법 분포
- 공고문 첨부 링크 표시
- CSV 내보내기

## 주의

공공데이터포털 API의 실제 상세기능명 또는 파라미터가 변경되면 `server.js`의 endpoint 설정을 맞춰야 합니다.
