/**
 * 浏览器随机源（带兜底）＝房间里那两个号码的**唯一取数处**。
 *
 * 为什么要兜底（2026-10-28 两台机器实测撞出来的）：`crypto.randomUUID` 只在"安全上下文"里存在，
 * 而局域网／虚拟网直连填的是 `http://<一串 IP>` ⇒ 那个函数压根不在，客人点「进房间」
 * 在拨号之前就抛异常、一声不响。J1–J4 全部实测都走的是"同机＋localhost"，
 * `localhost` 算安全上下文，所以这根线从没露过馅。
 *
 * 两格号码共用这一处：客人自报的**身份号**（`netSession.newPeerId`）与房主生成的**房间码**
 * （`netProtocol.createRoomCode`）——它们是同一个病：一个不存在就整个进不了房。
 * 取数按"能拿到的最好那个"层层退：`getRandomValues` 在就用它（它比 `Math.random` 硬），
 * 不在才退到 `Math.random`。
 *
 * ⚠️ 退到 `Math.random` 那一条**不是密码学随机**：房间码变得可猜、身份号变得可撞。
 * 这一版本来就不防作弊（大厅页脚那句话常驻），而撞号的表现是房主把第二个人当成第一个
 * （名册按 id 认人），所以兜底号里带一个进程内自增计数——同一页要两个号时也保证不重。
 * 这条降级只该出现在非安全上下文的直连里；要真把随机性当安全边界，得先把页面放到 https 上。
 */

/** 身份号的兜底前缀：一眼看得出这台机器没有 `randomUUID`（远程排障时这条比日志好认）。 */
const FALLBACK_ID_PREFIX = 'p';
/** 兜底号里那串随机的字节数（8 个十六进制字符）。 */
const FALLBACK_ID_BYTES = 4;

/** 取 `length` 个随机字节：有浏览器熵源就用，没有才自己拼。 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

let issued = 0;

/** 房间里每个人自报的那个身份号。协议层要求它非空且不超过 64 个字符。 */
export function randomPeerId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid === 'string' && uuid.length > 0) return uuid;
  issued += 1;
  const rand = Array.from(randomBytes(FALLBACK_ID_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${FALLBACK_ID_PREFIX}-${Date.now().toString(36)}-${issued.toString(36)}-${rand}`;
}
