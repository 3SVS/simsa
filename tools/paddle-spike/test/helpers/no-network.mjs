/**
 * `node --import ./test/helpers/no-network.mjs <script>` 로 자식 프로세스에 주입한다.
 * fetch 가 한 번이라도 불리면 즉시 종료 코드 97로 죽는다 → "키 없음이면 네트워크 0"을
 * 종료 코드로 증명한다(정직 종료 코드는 3).
 */
globalThis.fetch = () => {
  process.stderr.write("NO_NETWORK_VIOLATION: fetch called\n");
  process.exit(97);
};
