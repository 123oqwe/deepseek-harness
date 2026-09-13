# P3-12 preFlight — Workspace 路径、附件准入与恶意输入边界强化

测于 `f24573ddfe`(lane A,2026-09-13)。**只量不改码。**

## 重锚中性:**否** —— 四项里唯一不中性的一项

10 个声明文件里有 **一个落在 BASE-ALIGN 冲突集**:

**`packages/workspace/workspace/src/paths.ts`** —— 上游 **+43/−8**,我们 **+31/−2**;按行级判据,两侧**各改各的行,可组合**(见 `base-align-reverify-checklist.md` 的行级分类节,该文件在"18 个可组合"一侧)。

但"可组合"不等于"无关"——**上游改的恰好是 must[0] 的主语**:

| | 我们(f24573ddfe) | 上游(c291e7961a) |
|---|---|---|
| 规范化入口 | `realpathNormalize(path)` → 直接 `await realpath(path)` | 同名函数,**先 `fullyQualifiedWorkspacePath(path)` 守卫,不合格在 `realpath` 之前就拒** |
| 新增导出 | — | `fullyQualifiedWorkspacePath`(第 16 行) |
| import | `realpath, stat` | `realpath`(去掉 `stat`) |

**即上游已经自行做了一部分路径加固**:相对路径在 `realpath` 之前被拒绝。gap 文档对 P1-07 也记过同一处("relative paths now rejected before realpath")。

**对 P3-12 的三重后果**:
1. **must[0]**(「所有路径操作用 openat/handle 风格或执行前重新验证 inode,禁止 symlink escape」)的现状会随重锚**改变**——重锚后的基线已含一层守卫,本项要加的是**另一层**(inode 重验 / openat),不是同一层;
2. 若**在重锚前**实现 must[0],重锚时要在这个文件上把两套加固合并一次;**在重锚后**实现则一次成型;
3. 上游去掉了 `stat` 的 import,而我们的第 35 行注释提到 **device/inode 对**——must[0] 的 inode 重验若依赖 `stat`,重锚后需重新引入,**这是合并时最容易被"可组合"三个字盖过去的一处**。

**建议(排期决定,delegate 裁)**:**P3-12 排在 BASE-ALIGN 之后**。它是四项里唯一有此性质的,其余三项(P3-02 / P3-06 / P3-10)可在重锚前推进。

## 出厂现状(其余九个声明文件)

| 面 | 现状 |
|---|---|
| `workspace/src/paths.ts` / `entity.ts` | 有 `realpath` 规范化与 device/inode 概念;**无 openat/handle 风格,无执行前 inode 重验** |
| `attachment/src/{admission,error,types}.ts` | 存在,即 must[1] 要扩的准入面 |
| `sandbox/sandbox/src/roots.ts` | 存在(也是 P3-01 的声明文件之一) |
| `attachment-security/*`(3 个 [N]) | **不存在,全新** —— must[1] 的 MIME sniff / 解压比 / 嵌套深度 / 宏与可执行检测都落这里 |
| `workspace/tests/path-race.e2e.ts` [N] | 不存在,全新 —— acceptance[0] 的竞态攻击面 |

## 三条 acceptance 的可观测性

| 子句 | preFlight 判断 |
|---|---|
| acceptance[0] path swap / symlink / hardlink / case-fold / Unicode 路径攻击失败 | **五种攻击的可观测性不同**:symlink/hardlink 可在临时目录构造;**case-fold 与平台强相关**(macOS 默认大小写不敏感、Linux 敏感),同一份用例在两平台含义不同,C 阶段须声明在哪个平台上冻结;path swap 是**竞态**,`path-race.e2e.ts` 的命名说明已预期到,但竞态用例的稳定性要先设计好(否则会长成又一个 intermittent) |
| acceptance[1] zip bomb / polyglot / 伪 MIME / 恶意文档不进入模型或宿主 parser | 可在数据层观测,**但"不进入模型"需要真到达面**:须证明拒绝发生在进入模型上下文**之前**,而不是在某个库里。这是"在做决定的那个操作里执行决定"那条(packages/AGENTS.md) |
| acceptance[2] 跨租户 content hash 不导致引用泄漏 | 纯数据层可观测,**最容易先做**;与 P2-01 的租户模型相接 |

## 未量

- `attachment/src/admission.ts` 今天已做哪些检查(须逐项列,才知道 must[1] 是扩还是重写);
- 造/用账本对 MIME sniff / 解压炸弹检测是否判 adapt(这类检测有成熟开源实现,**开工前必查账本**,否则可能手写一个账本判 adapt 的东西);
- acceptance[0] 五种攻击在 CI 两平台上的可观测性矩阵。
