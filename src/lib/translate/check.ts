/**
 * What a Traditional Chinese gloss must not contain, checked before it is
 * written -- the prompt asks for Taiwan usage, and asking is not enough.
 *
 * Measured on the first 11,429 translated senses: 19 carried Simplified
 * characters (各种各样, 难以置信, 漠不关心), 52 left English words behind
 * (過早； premature, 稍微；-ish), and a handful used mainland vocabulary (視頻,
 * 用戶, 自行車). None of it was caught, because the only check was the count.
 */

/**
 * Characters that exist only in Simplified Chinese. Deliberately not every
 * simplification: a character Taiwan also writes -- 拮据, 温, 况, 够 as common
 * variants, 才 and 台 outright -- would reject correct glosses, and a
 * rejection costs a retry, so every entry here is one no Taiwan dictionary
 * writes.
 */
const SIMPLIFIED =
  '这们说对时过为会来个见话还让发学经没东车实问书门长开关头动写听买卖钱给认应该么现爱电亲' +
  '点边样难运节师员语读转选远际带单变历务战级约红结总觉观极灯龙马鱼鸟网气热线层产业乐习' +
  '从众优传伤体兴农净减击则刚创剧办劳势协压厌县参双号吗启响团围园图圆圣场坏块坚处' +
  '备夹夺奋奖妈宝审寻导寿将尔岁岛币帅帮广庆库应废异张弯归当录忆忧怀态恋恶恼惊惯愿户' +
  '扩扫扬护报担拥拨择挡挤挥损换摄摆敌数断无旧显晓晕术机杀杂权条杨构枪标树桥梦检楼欢' +
  '毁毕汇汉汤沟泪洁浅测济浓润涨湾湿满灭灵灾炉烂烦烧热牵犹独狮猎献环画疗盐监盖盘确礼' +
  '离种积称稳穷窃竞笔简紧纠纤纪纯纲纳纵纷纸练组细织终绕绘络绝统继绩续维综绿缓编缘罗罚' +
  '职联肠肤胜脏脑艰苏药获营虑虽补装规视览计讨训议记讲许论设访证评识诉词译试诗询详误' +
  '请课谁调谈谢贝负财责败货质购贵费资赏赛赞赶跃轨轮软轻载较辆辈输达迁违连迟适递遗邮邻释' +
  '针钟钢铁银链销锁锅错镜闪闭闲间闹闻阅队阳阴阵阶陆陈险随隐雾静页顶项顺须顾预领频题颜额' +
  '风飞饭饮饱馆驾验骑鲜鸣黄齐齿龄';

/**
 * Japanese shinjitai that are neither Traditional nor Simplified. A model
 * translating a Japanese headword's senses copies them from the headword --
 * 気 for 氣, 様 for 樣 -- and they read as wrong to a Taiwanese reader exactly as
 * Simplified does. Same restraint as above: only forms Taiwan never writes.
 */
const JAPANESE =
  '気図変対様読楽帰歳浅険検験転伝売続総発労営県圧駅絵拡覚関観犠拠挙駆経軽継鶏芸権剣圏顕' +
  '厳広黒砕済斎剤雑桟惨賛残歯児辞湿釈収従渋獣縦粛奨焼証剰壌嬢浄畳譲醸寝尽粋酔髄枢瀬摂専' +
  '戦潜践銭禅捜挿巣蔵臓滝択沢胆弾遅昼鋳庁聴逓鉄闘稲徳届弐悩脳廃拝髪抜晩蛮浜払仏歩訳薬誉' +
  '揺謡頼乱覧竜猟緑涙塁励霊齢恋楼湾蛍渓茎径恵勅実写国会価仮円塩囲陥旧峡狭暁区撃献効' +
  '鉱号参蚕糸乗触図数声静斉窃騒蔵担団断届悩廃売麦満黙揺頼覧両絵処寿双壮争荘装増帯単属' +
  '堕滞状条称将';

const FORBIDDEN = new Map<string, string>();
for (const char of SIMPLIFIED) FORBIDDEN.set(char, '簡體字');
for (const char of JAPANESE) FORBIDDEN.set(char, '日文字形');

/** Mainland vocabulary, each with the Taiwan word the model should have used. */
const MAINLAND: Array<[string, string]> = [
  ['視頻', '影片'],
  ['用戶', '使用者'],
  ['自行車', '腳踏車'],
  ['軟件', '軟體'],
  ['硬件', '硬體'],
  ['網絡', '網路'],
  ['信息', '訊息'],
  ['屏幕', '螢幕'],
  ['鼠標', '滑鼠'],
  ['默認', '預設'],
  ['打印', '列印'],
];

/**
 * JMdict's own tags (n, vs, adj-no) or IPADIC-style labels in brackets at the
 * head of a gloss. The model adds these from the `（pos）` it is shown, although
 * the English it translates has none -- 982 senses opened on （助詞）, some of
 * them wrong: ない came back as （形容動詞、接尾詞）.
 */
const LEADING_LABEL =
  /^（(?:[a-z0-9-]+(?:[,，、][a-z0-9-]+)*|(?:[名動形副助連代感接量數自他前後綴頭尾體詞態語言容]+[、，,]?)+)）\s*/u;

/**
 * Drops a part-of-speech label the model put in front of the gloss, when the
 * English it translated opened with no bracket of its own. A bracket the source
 * had -- "(switched) off" -- is a translation, and stays.
 */
export function stripAddedLabel(zh: string, en: string): string {
  if (/^\s*\(/.test(en)) return zh;
  const stripped = zh.replace(LEADING_LABEL, '');
  return stripped === '' ? zh : stripped;
}

/**
 * Why a gloss cannot be written, or null when it can. The reason is in Chinese
 * because it goes back to the model on the retry, which does better told what
 * was wrong than simply asked again.
 */
export function glossProblem(zh: string, en: string): string | null {
  for (const char of zh) {
    const kind = FORBIDDEN.get(char);
    if (kind) return `「${zh}」含有${kind}「${char}」，請改用台灣繁體字。`;
  }
  for (const [mainland, taiwan] of MAINLAND) {
    if (zh.includes(mainland)) {
      return `「${zh}」用了中國大陸用語「${mainland}」，台灣說「${taiwan}」。`;
    }
  }
  // An English word left untranslated. All-capitals are left alone -- CPU, DVD
  // and ESC are how Chinese writes them too -- and so is a name the English
  // itself carries as it is: a binomial (Felis catus), a brand (Post-it), or a
  // hyphenated transliteration (mano-vijnana). There is no Chinese for them to be.
  let previous: string | null = null;
  for (const word of zh.match(/(?<![A-Za-z])[A-Za-z]+(?:-[A-Za-z]+)*/gu) ?? []) {
    const kept =
      !/[a-z]{3}/u.test(word) ||
      (/^[A-Z]/u.test(word) && en.includes(word)) ||
      (previous !== null && en.includes(`${previous} ${word}`)) ||
      (word.includes('-') && en.includes(word));
    if (!kept) return `「${zh}」留下了未翻譯的英文「${word}」。`;
    previous = word;
  }
  if (LEADING_LABEL.test(zh) && !/^\s*\(/.test(en)) {
    return `「${zh}」開頭加了英文原文沒有的詞性標籤，請拿掉。`;
  }
  return null;
}
