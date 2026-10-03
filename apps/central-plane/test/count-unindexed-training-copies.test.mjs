/**
 * count-unindexed-training-copies.test.mjs — Train K · K-3 도구(색인 이전 학습 사본 개수)의 순수 부분.
 *
 * 스크립트는 새 파일이라 전부 옛 코드에서 실패한다(파일 없음) — 회귀 증거가 아니라 도구 검증이다.
 * 네트워크 없음: 서명은 AWS 공개 문서의 SigV4 예제(ListObjects GET /?max-keys=2&prefix=J)와 대조하고,
 * R2 호출은 하지 않는다(라이브 R2 목록 조회 = 미측정).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const tool = await import("../scripts/count-unindexed-training-copies.mjs");

test("SigV4: AWS 문서의 ListObjects 예제와 같은 서명을 만든다", () => {
  // AWS 공개 문서(Signature V4 — "GET Bucket (List Objects)") 예제 값. 실제 키가 아니다.
  // 비밀 값은 스캐너 오탐을 피하려고 둘로 나눠 적었다. 접근 키 id는 서명에 들어가지 않아 임의 값.
  const secret = "wJalrXUtnFEMI/K7MDENG" + "/bPxRfiCYEXAMPLEKEY";
  const r = tool.signV4({
    method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/", query: { "max-keys": "2", prefix: "J" },
    amzDate: "20130524T000000Z", region: "us-east-1", service: "s3", accessKeyId: "EXAMPLE_ID", secretAccessKey: secret,
  });
  assert.equal(r.signature, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  assert.equal(r.canonicalQuery, "max-keys=2&prefix=J");
  assert.match(r.authorization, /^AWS4-HMAC-SHA256 Credential=EXAMPLE_ID\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=/);
});

test("SigV4 쿼리 인코딩: 접두어의 '/'·이어받기 토큰의 '+='는 퍼센트 인코딩, 키는 정렬", () => {
  const r = tool.signV4({
    method: "GET", host: "acct.r2.cloudflarestorage.com", path: "/simsa-evidence",
    query: { prefix: "journey/", "list-type": "2", "continuation-token": "a+b/c=" },
    amzDate: "20260930T000000Z", region: "auto", service: "s3", accessKeyId: "id", secretAccessKey: "s",
  });
  assert.equal(r.canonicalQuery, "continuation-token=a%2Bb%2Fc%3D&list-type=2&prefix=journey%2F");
});

test("ListObjectsV2 XML 파싱: 키·시각·이어받기 토큰, XML 이스케이프 해제", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>
    <Contents><Key>events/KR/2026/09/01/wprr_a.json</Key><LastModified>2026-09-01T00:00:00.000Z</LastModified></Contents>
    <Contents><Key>journey/2026/09/02/wsp______/wprr_&amp;b.json</Key><LastModified>2026-10-02T00:00:00.000Z</LastModified></Contents>
    <IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken></ListBucketResult>`;
  const p = tool.parseListObjectsV2(xml);
  assert.deepEqual(p.objects.map((o) => o.key), ["events/KR/2026/09/01/wprr_a.json", "journey/2026/09/02/wsp______/wprr_&b.json"]);
  assert.equal(p.truncated, true);
  assert.equal(p.nextToken, "tok&1");
  assert.deepEqual(tool.parseListObjectsV2("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"), { objects: [], truncated: false, nextToken: null });
});

test("집계: 기준 시각 이전 · 이후 · 시각 모름(추측하지 않음)", () => {
  const t = tool.tally(
    [
      { key: "a", lastModified: "2026-09-01T00:00:00.000Z" },
      { key: "b", lastModified: "2026-10-02T00:00:00.000Z" },
      { key: "c", lastModified: null },
    ],
    "2026-10-01T00:00:00Z",
  );
  assert.deepEqual(t, { total: 3, beforeCutoff: 1, unknownTime: 1 });
});

test("인자: --before 필수(ISO) · 버킷 이름 검사 · 모르는 인자 거부 — 출력은 개수뿐(키 없음)", () => {
  assert.ok("error" in tool.parseArgs([]));
  assert.ok("error" in tool.parseArgs(["--before=not-a-date"]));
  assert.ok("error" in tool.parseArgs(["--before=2026-10-01T00:00:00Z", "--bucket=../etc"]));
  assert.ok("error" in tool.parseArgs(["--before=2026-10-01T00:00:00Z", "--delete"]));
  assert.deepEqual(tool.parseArgs(["--before=2026-10-01T00:00:00Z"]), { bucket: "simsa-evidence", before: "2026-10-01T00:00:00Z" });
  const out = tool.render([{ prefix: "journey/", total: 3, beforeCutoff: 2, unknownTime: 0 }], "2026-10-01T00:00:00Z");
  assert.match(out, /\| journey\/ \| 3 \| 2 \| 0 \|/);
  assert.doesNotMatch(out, /wprr_|wsp_/);
  assert.deepEqual([...tool.PREFIXES], ["events/", "journey/", "training/"]);
});
