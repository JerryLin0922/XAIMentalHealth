/* ------------------------------------------------------------------
   本地陪伴服务（Local Companion Service）

   这是一个跑在本页进程内的规则引擎，**不是网络服务、不调用任何外部接口**。
   调用方只能传入两类内容：
     1) message —— 用户这一句想说的话
     2) summary —— 最近 14 天的统计摘要（均值 / 极值 / 趋势斜率）
   服务入口会做严格裁剪：任何原始记录、日期明细、备注原文都会被丢弃，
   命中危机词时直接返回求助资源，不做任何"分析"。
   ------------------------------------------------------------------ */
(function (MH) {
  'use strict';

  var U = MH.util;

  var CRISIS_RESOURCES = [
    { name: '全国统一心理援助热线', contact: '12356（24 小时）' },
    { name: '北京心理危机研究与干预中心', contact: '010-8295-1332' },
    { name: '希望 24 热线', contact: '400-161-9995' },
    { name: '紧急危险情况', contact: '110 / 120' }
  ];

  var CRISIS_RE = /(自杀|不想活|活不下去|活着没意义|没有意义活|结束生命|轻生|自残|伤害自己|想死|死了算了|跳楼|割腕|吞药|遗书|告别这个世界|撑不下去了|消失算了)/;

  var INTENTS = [
    { key: 'sleep', re: /睡|失眠|睡不着|早醒|熬夜|多梦|醒得早|睡眠/ },
    { key: 'stress', re: /压力|喘不过气|扛不住|太累了心|焦头烂额|忙不过来|deadline|截止|ddl|绩效|考核/ },
    // 委屈要在低落之前判定：两者常叠在一起，但被看见的需要与「低气压」不是一回事
    { key: 'grievance', re: /委屈|凭什么|背锅|明明.{0,6}努力|没人看见|没人看到|我说了不算|我不重要|不甘心|不甘/ },
    { key: 'moodLow', re: /低落|难过|难受|想哭|沮丧|抑郁|开心不起来|提不起劲|没劲|空虚|emo|丧|不开心|心情差/ },
    { key: 'anxiety', re: /焦虑|紧张|心慌|慌|害怕|担心|不安|panic|慌张|胡思乱想/ },
    { key: 'anger', re: /生气|愤怒|烦躁|烦死了|想骂人|受不了|气死|窝火/ },
    { key: 'lonely', re: /孤独|一个人|没人懂|没人陪|寂寞|想找人|陪我|没人说话/ },
    { key: 'tired', re: /累|疲惫|乏力|没力气|困|透支| burnout|倦怠/ },
    // 兴奋排在「好」之前：正向情绪同样值得被看清楚是哪一部分带来的
    { key: 'excitement', re: /兴奋|激动|太开心|开心死|开心到|居然做到了|居然成了|一下子有好多想法|停不下来.{0,4}想|想马上开始|好到不敢相信/ },
    { key: 'good', re: /开心|不错|挺好|还好|顺利|高兴|感恩|谢谢|舒服|放松|状态好|进步/ },
    { key: 'greeting', re: /^(你好|hi|hello|嗨|哈喽|在吗|在么)/i }
  ];

  function metricLine(summary, key) {
    var s = summary && summary.metrics && summary.metrics[key];
    if (!s || s.mean == null) return null;
    var def = MH.metrics.get(key);
    var label = (s.trend && s.trend.label) || '持平';
    return def.label + '均值 ' + U.num(s.mean, def.dp) + ' ' + def.unit + '（近两周' + label + '）';
  }

  function trendPhrase(summary, key) {
    var s = summary && summary.metrics && summary.metrics[key];
    if (!s || !s.trend) return null;
    var def = MH.metrics.get(key);
    var dir = s.trend.direction;
    var amount = s.trend.changePerWeek;
    if (dir === 'flat' || amount == null) return def.label + '基本平稳';
    var v = Math.abs(amount);
    var text = def.label + (dir === 'up' ? '上升' : '下降') + '约 ' + U.num(v, def.dp) + ' ' + def.unit + '/周';
    return text;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ---------- XAI 组装辅助：证据口径 / 上一版被推翻的说明 ---------- */

  function basisOf(s) { return MH.xai.basis(s && s.daysWithData, s && s.windowDays); }

  function evidenceOf(list) { return list.filter(Boolean); }

  /** 长档统一补的「推理边界」：数据能到哪里，就停在哪里。 */
  function boundary(confidence) {
    var st = MH.xai.strength(confidence);
    return '边界：这几个数都是聚合出来的，' + st.hedge + '。它看不到昨天那件具体的事，' +
      '也看不到你当时为什么那样做——那部分只有你知道。';
  }

  /** 把可选的若干段拼成长档；空段落会被丢掉，避免出现孤零零的空行。 */
  function joinLong(parts) { return parts.filter(Boolean).join('\n\n'); }

  /* ============================ 各意图的回应模板 ============================

     每个模板返回一份 XAI 规格：
       short    一句话：先把结论给出来，让人决定要不要往里读
       medium   标准版：结论 + 依据 + 一件可以做的事
       long     展开版：把推论摊开 —— 证据、具体场景、推理边界、可选的下一步
     「降低使其relationships可核查」由 MH.xai.compose 统一处理：
       断言降调、补全三档、附依据、结尾请求校正。 */

  var REPLIES = {
    greeting: function (s) {
      var l = metricLine(s, 'mood');
      var b = basisOf(s);
      return {
        short: '我在。你想先说今天，还是先让我讲讲这两周？',
        medium: '我在。' + (l ? '你最近两周' + l + '。' : '') +
          '\n不过这只是平均值，今天的你才是准的。从哪儿开始都行。',
        long: joinLong([
          '我在，这次由你挑头：可以先讲今天发生的一件小事，也可以先让我讲这两周的趋势。',
          l ? '我能看到的只有一行很粗的账：你最近两周' + l + '。它看得到走势，看不到昨天发生了什么。' : '',
          MH.xai.personalize('数字看不出日子', '同样是「心情 3 分」，一种是被否掉一个方案后在会议室坐了一下午，一种是连着三天下雨没出门。数一样，底下的两天完全不同。'),
          '所以我不打算从这行账里替你总结什么。你丢一句没头没尾的话过来就行。'
        ]),
        evidence: evidenceOf([l]),
        basis: b,
        tags: ['开场']
      };
    },

    moodLow: function (s) {
      var l = metricLine(s, 'mood');
      var b = basisOf(s);
      var action = pick([
        '如果愿意，试着说一件今天让你稍微松一点的小事——哪怕只是水喝够了。',
        '要不要把现在脑子里转的那句话直接写下来？不用组织语言，原样丢给我就行。'
      ]);
      return {
        short: '这几天压着不少东西。它不需要马上被赶走。',
        medium: '听起来这几天压着不少东西。这种低气压不需要被马上赶走，先让它有个地方待着就好。\n' +
          (l ? '我这边看到你' + l + '。数字只是参考，你的感受才是准的。\n' : '') + action,
        long: joinLong([
          '听起来这几天压着不少东西。我先把结论摆在前面：这种低气压不需要被马上赶走，先让它有个地方待着就好。',
          l ? '我读到的是：你' + l + '。这是最近这些天的平均水平，不是你今天的评分。' : '',
          MH.xai.personalize('低落常常有它的用法', '有人在被通知调岗的那一周，连续四天什么都不想做，第五天才发现自己其实是在拖延一件必须做的决定——低落把决策窗口关小了，也顺手挡掉了几个冲动的选择。我不确定你这边是不是这回事。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: evidenceOf([l]),
        basis: b,
        tags: ['情绪低落', '陪伴']
      };
    },

    sleep: function (s) {
      var l = metricLine(s, 'sleep');
      var t = trendPhrase(s, 'sleep');
      var b = basisOf(s);
      var action = pick([
        '今晚可以试一件小事：睡前 30 分钟把屏幕放远，只留一盏暖灯。不用追求立刻睡着。',
        '如果躺下 20 分钟还醒着，就起来坐一会儿再回床上，别和「必须睡着」较劲。'
      ]);
      return {
        short: '睡眠一乱，白天什么都跟着变沉——先别急着怪自己状态差。',
        medium: '睡眠一乱，白天什么都跟着变沉。\n' +
          (l ? '你' + l + '，' + (t ? t + '。' : '') + '\n' : '') + action,
        long: joinLong([
          '睡眠一乱，白天什么都跟着变沉。这里我只说一件有把握的事：这两件事在你的记录里常常同时出现，但我没有证据说谁引起谁。',
          (l || t) ? '读到的是：你' + [l, t].filter(Boolean).join('；') + '。' : '',
          l && t ? MH.xai.association('睡眠时长偏低', '第二天更吃力', { days: s && s.daysWithData }) : '',
          MH.xai.personalize('睡眠不足会放大情绪', '有人周三只睡了四个半小时，周四在会上被一句平常的话刺到，当场就红了眼眶——那个场合本身没什么，稀缺的是前一晚那四个半小时。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: evidenceOf([l, t]),
        basis: b,
        tags: ['睡眠', '自我照顾']
      };
    },

    stress: function (s) {
      var st = metricLine(s, 'stress');
      var hr = metricLine(s, 'heartRate');
      var b = basisOf(s);
      var action = pick([
        '现在先做一轮慢呼吸：吸气 4 秒、停 2 秒、呼气 6 秒，重复 5 次。这不是鸡汤，是在给神经系统一个减速信号。',
        '把待办从脑子里搬到纸上，分成「今天必须」和「可以明天」两堆。搬完就等于卸载了一部分。'
      ]);
      return {
        short: '压力堆到这个程度，身体通常会先发出信号。',
        medium: '压力堆到这个程度，身体通常会先发出信号。\n' +
          (st ? '你' + st + '，' : '') + (hr ? hr + '。' : '') + '\n' + action,
        long: joinLong([
          '压力堆到这个程度，身体通常会先发出信号。这是记录里最一致的一处，也是我最有把握的一句。',
          [st, hr].filter(Boolean).length ? '读到的是：你' + [st, hr].filter(Boolean).join('；同时') + '。' : '',
          st && hr ? MH.xai.association('压力读数偏高', '心率也偏高', { days: s && s.daysWithData }) : '',
          MH.xai.personalize('身体比意志更早知道', '有人连着两周赶项目，自己觉得还能撑，是手表先跳出静息心率上了一个台阶——他以为是天气热，其实是身体在替他叫停。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: evidenceOf([st, hr]),
        basis: b,
        tags: ['压力', '呼吸练习']
      };
    },

    anxiety: function (s) {
      var b = basisOf(s);
      var action = pick([
        '试着找一个能说出来的东西：5 样看得见的、4 样摸得到的、3 样听得到的。把注意力从预测拉回此刻。',
        '把「我在担心什么」写成一句完整的话。写出来之后，它通常会从一团雾变成一个可以对付的具体问题。'
      ]);
      return {
        short: '慌的时候，人会被「还没发生的事」拽着走。',
        medium: '慌的时候，人会被「还没发生的事」拽着走。\n' + action,
        long: joinLong([
          '慌的时候，人会被「还没发生的事」拽着走。这是我的解释，不是一个已经确定的机制——你觉得准不准，比我怎么看更重要。',
          MH.xai.personalize('焦虑擅长替人预测未来', '有人凌晨三点把明天汇报可能出的七种错都想了一遍，第二天只发生了其中最轻的那种，而他已经白熬了一夜——担心的部分兑现了，代价却提前付了整整一倍。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: [],
        basis: b,
        tags: ['焦虑', '回到当下']
      };
    },

    anger: function (s) {
      var b = basisOf(s);
      var action = pick([
        '先给身体一个出口：快走十分钟，或者把想说的话先写下来不发。等心率降下来再决定要不要表达。',
        '试着把它翻译成一句「我需要……」。愤怒背后通常藏着一个没被满足的需要。'
      ]);
      return {
        short: '生气常常是在说：某个边界被踩了。它本身不是坏事。',
        medium: '生气常常是在说：某个边界被踩了。它本身不是坏事。\n' + action,
        long: joinLong([
          '生气常常是在说：某个边界被踩了。它本身不是坏事——这是我到目前为止最愿意相信的一种读法，但它完全可能是另一种：你当天只是太累了。',
          MH.xai.personalize('愤怒后面通常有一句没说出口的需要', '有人因为同事临时甩锅炸了半天，真正在说的是「我需要有人提前告诉我」——把这句说完之后，火气当天下午就退了。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: [],
        basis: b,
        tags: ['愤怒', '边界']
      };
    },

    lonely: function (s) {
      var b = basisOf(s);
      var action = pick([
        '孤独最难的地方是「说了也没用」这个预设。你已经说出来了，这本身就是一步。',
        '如果想找真人，我可以给你一些 24 小时都在的心理热线，随时可以说。'
      ]);
      return {
        short: '我在这儿，不会评判你。你已经说出来了，这就是一步。',
        medium: '我在这儿，不会评判你。\n' + action,
        long: joinLong([
          '我在这儿，不会评判你。先说清楚我做不到什么：我给不了真人那种在场感，只能陪你把话说完。',
          MH.xai.personalize('“说了也没用”这个预设', '有人攒了一肚子话，最后只发出「在吗」两个字——不是没话说，是先要确认对面会不会接住。你刚才这一步，等于替自己试了一次。'),
          boundary(b.confidence),
          action
        ]),
        evidence: [],
        basis: b,
        tags: ['孤独', '陪伴']
      };
    },

    grievance: function (s) {
      var b = basisOf(s);
      var action = pick([
        '把「我其实希望……」写成一句完整的话。只写给自己看，不用发给任何人。',
        '如果愿意，说一件你做了、但没人提起过的事——哪怕它很小。'
      ]);
      var seen = '这听起来是委屈。被忽略的付出也是付出，它不是矫情。';
      return {
        short: seen,
        medium: seen + '\n' + action,
        long: joinLong([
          seen + '我先把读法摆在前面：这是目前我更愿意相信的一种读法，也完全可能是另一种：你今天只是太累了。',
          MH.xai.personalize('委屈常常指向「被看见」这个需要', '有人在项目收尾时被一句「这个谁都能做」带过，让他难受的不是那句话本身，是前面三个月晚走的事一次都没被提过。愤怒对着外面，委屈对着自己，两样常常叠在一起。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: [],
        basis: b,
        tags: ['委屈', '被看见']
      };
    },

    tired: function (s) {
      var sl = metricLine(s, 'sleep');
      var b = basisOf(s);
      var action = pick([
        '今天能不能给自己排一件「什么都不做」的 15 分钟？不是休息为了更高效率，就是单纯允许停下。',
        '先补最基础的三样：水、饭、睡。别在缺觉的时候做重大决定。'
      ]);
      return {
        short: '累到这个份上，不是靠意志力能顶过去的。',
        medium: '累到这个份上，不是靠意志力能顶过去的。\n' +
          (sl ? '你' + sl + '，身体的账迟早要还。\n' : '') + action,
        long: joinLong([
          '累到这个份上，不是靠意志力能顶过去的。我说得更直白一点：意志力在这里不是解法，补账才是。',
          sl ? '读到的是：你' + sl + '。' : '',
          MH.xai.personalize('把疲惫当成性格问题会误判', '有人年末连轴转了三周，开始怀疑自己「是不是变懒了」；休假回来同样的工作量，他又恢复到原来的节奏——变的不是毅力，是账本上的欠额。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: evidenceOf([sl]),
        basis: b,
        tags: ['疲惫', '休息']
      };
    },

    excitement: function (s) {
      var l = metricLine(s, 'mood');
      var b = basisOf(s);
      var action = pick([
        '把它写进今天的记录里，哪怕只一句。以后低气压的时候，你会需要看到今天这一页。',
        '先不急着开下一件：花一分钟说清楚，是哪一小部分让你最兴奋。'
      ]);
      var worth = '真好，这种时刻值得被记下来——不是因为要正能量，是因为它有用。';
      return {
        short: worth,
        medium: worth + '\n' + (l ? '你' + l + '，趋势是往上的。\n' : '') + action,
        long: joinLong([
          '真好，这种时刻值得被记下来。它值得被特意存一个副本，不只因为好，还因为有用：低落的时候，这一页能当证据用。',
          l ? '读到的是：你' + l + '。' : '',
          MH.xai.personalize('看清是哪一部分让人兴奋，比记住「今天挺好」更耐用', '有人做成一件事后只写下「今天不错」，三个月后再看完全想不起是什么在起作用；后来他改成写「下午那两小时没人打断」，低落时照着这个条件去复现，比任何鼓励都管用。'),
          boundary(b.confidence),
          '可以试的一件小事：' + action
        ]),
        evidence: evidenceOf([l]),
        basis: b,
        tags: ['正向时刻', '兴奋']
      };
    },

    good: function (s) {
      var l = metricLine(s, 'mood');
      var b = basisOf(s);
      return {
        short: '真好，这种时刻值得被记下来。',
        medium: '真好，这种时刻值得被记下来。\n' +
          (l ? '你' + l + '，趋势是往上的。\n' : '') +
          '把它写进今天的记录里吧——以后低气压的时候，你会需要看到今天这一页。',
        long: joinLong([
          '真好，这种时刻值得被记下来。它值得被特意存一个副本，不只因为好，还因为它有用。',
          l ? '读到的是：你' + l + '。' : '',
          MH.xai.personalize('好状态是以后能反复取用的材料', '有人在低落那周翻回三个月前的一条记录：「今天在楼下便利店听到老歌，站那儿听完了整首」。他后来跟我说，那一行字比任何道理都管用——因为它证明他确实好过，不是记错了。'),
          boundary(b.confidence),
          '今天可以做的：把这件事写进记录里，哪怕只一句。以后低气压的时候，你会需要看到今天这一页。'
        ]),
        evidence: evidenceOf([l]),
        basis: b,
        tags: ['正向时刻', '记录']
      };
    },

    fallback: function (s) {
      var m = metricLine(s, 'mood'), sl = metricLine(s, 'sleep');
      var st = metricLine(s, 'stress');
      var b = basisOf(s);
      var ev = evidenceOf([m, sl, st]);
      var ask = pick([
        '想接着说说具体发生了什么吗？哪怕只是一句话。',
        '如果不知道从哪儿说起，就先说身体：现在最明显的感受在哪儿？'
      ]);
      return {
        short: ev.length ? '我把最近的统计看了一遍，但在你说更多之前，我不会先替你总结。' : '你说的话就是最主要的信息，我不先猜。',
        medium: (ev.length
          ? '我把最近 ' + (s && s.windowDays || 14) + ' 天的统计看了一遍：' + ev.join('，') + '。这只是读数，不是对你的判断。'
          : '你还没有足够的记录，所以我先不猜——你说的话就是最主要的信息。') + '\n' + ask,
        long: joinLong([
          ev.length
            ? '我把最近 ' + (s && s.windowDays || 14) + ' 天的统计看了一遍。先把话放这儿：这几个数在我眼里是读数，不是对你的判断。'
            : '你还没有足够的记录，所以我先不猜。',
          ev.length ? '读到的是：' + ev.join('；') + '。' : '',
          MH.xai.personalize('同一个数字底下可以有完全不同的两天', '同样是「压力 6 分」，一种是被一个快到期的项目顶着，另一种仅仅是当天没吃早饭、赶了两趟地铁。我手上没有哪一条是原因的信息——那部分要你说。'),
          boundary(b.confidence),
          ask
        ]),
        evidence: ev,
        basis: b,
        tags: ['倾听']
      };
    }
  };

  /* ============================ 服务入口 ============================ */

  /**
   * 发起一次回应。
   * @param {{message: string, summary: Object}} request 只接受这两项
   * @returns {Promise<{text:string, layers:Object, tags:string[], crisis:boolean, resources:Array}>}
   */
  function generateReply(request) {
    var req = request || {};
    // 严格裁剪：只保留文本与统计摘要；任何其他字段（含原始记录）一律丢弃
    var payload = {
      message: String(req.message || '').slice(0, 1000),
      summary: sanitizeSummary(req.summary)
    };

    var text = payload.message.trim();

    if (CRISIS_RE.test(text)) {
      return Promise.resolve({
        text: '你刚才说的话让我很担心你的安全。我没有能力判断或处理这种情况，但我希望你现在不要一个人扛。\n' +
          '下面这些渠道 24 小时都有人接，打过去不需要准备任何说辞。',
        tags: ['安全优先'],
        crisis: true,
        resources: CRISIS_RESOURCES,
        payload: payload
      });
    }

    var intent = null;
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(text)) { intent = INTENTS[i].key; break; }
    }
    if (!intent && text.length === 0) intent = 'greeting';

    var maker = REPLIES[intent] || REPLIES.fallback;
    var spec = maker(payload.summary);

    // 上一版被当事人推翻过的解释，在新一版里先承认、再绕开
    var revised = MH.xai.revisionNote();
    if (revised) spec.long = revised + '\n\n' + spec.long;

    var ex = MH.xai.compose(spec, { level: MH.xai.defaultLevel() });

    var out = {
      text: ex.text,
      layers: ex,
      tags: ex.tags,
      crisis: false,
      resources: null,
      intent: intent || 'fallback',
      payload: payload
    };

    // 模拟一次本地服务往返，界面上会显示"服务处理中"
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(out); }, 260);
    });
  }

  /* ============================ 智能问答 ============================ */

  /**
   * 基于多来源上下文生成回答。
   * 入参同样会被严格裁剪：只保留问题、补充说明、上下文文本与已算好的事实条目。
   * @param {{question:string, customPrompt?:string, intent?:string, context:Object, facts:Array}} request
   */
  function generateAnswer(request) {
    var req = request || {};
    var payload = {
      question: String(req.question || '').slice(0, 1000),
      customPrompt: String(req.customPrompt || '').slice(0, 2000),
      intent: req.intent || 'summary',
      context: sanitizeContext(req.context),
      facts: (Array.isArray(req.facts) ? req.facts : []).slice(0, 12).map(sanitizeFact)
    };

    if (CRISIS_RE.test(payload.question)) {
      return Promise.resolve({
        text: '你刚才说的话让我很担心你的安全。我没有能力判断或处理这种情况，但我希望你现在不要一个人扛。\n下面这些渠道 24 小时都有人接。',
        tags: ['安全优先'], crisis: true, resources: CRISIS_RESOURCES, payload: payload
      });
    }

    var stats = payload.facts.filter(function (f) { return f.type === 'stat'; });
    var quotes = payload.facts.filter(function (f) { return f.type === 'quote'; });
    var memos = payload.facts.filter(function (f) { return f.type === 'memory'; });
    var found = stats.length + quotes.length;

    /* ---- 三档：短 = 一句话结论，中 = 要点，长 = 证据 + 推理边界 ---- */

    var short = found
      ? (stats.length
        ? stats[0].text.replace(/^（[^）]*）\s*/, '')
        : '找到 ' + quotes.length + ' 段相关原文，但没有可直接计算的数值列。')
      : '在选中的来源里没有找到与这个问题相关的证据。';

    var mediumLines = ['基于本机检索与统计生成，未联网、未调用任何外部模型。'];
    if (stats.length) {
      mediumLines.push('');
      stats.forEach(function (s) { mediumLines.push('· ' + s.text); });
    } else if (quotes.length) {
      mediumLines.push('');
      mediumLines.push('· 选中的来源里没有能直接计算的数值列，下面给出检索到的原文片段。');
    }
    if (memos.length) {
      mediumLines.push('');
      mediumLines.push('你之前问过相关的，可以连起来看：');
      memos.forEach(function (m) { mediumLines.push('· ' + m.text + ' —— ' + m.source); });
    }
    if (!found) {
      mediumLines.push('');
      mediumLines.push('没能在选中的来源里找到与这个问题相关的证据。可以试试：换成更具体的关键词、勾选更多数据源，或在「补充说明」里告诉我每一列分别代表什么。');
    }

    var longLines = mediumLines.slice();
    if (quotes.length) {
      longLines.push('');
      longLines.push('相关原文片段：');
      quotes.forEach(function (q, i) {
        longLines.push((i + 1) + '. 「' + q.text + '」 —— ' + q.source);
      });
    }
    if (found) {
      longLines.push('');
      longLines.push('这份回答的推理边界：');
      longLines.push('· 只取自你勾选的数据源（' + (payload.context.usedSources.slice(0, 3).join('、') || '本次上下文片段') + '），没有覆盖到的部分我不会凭空补。');
      longLines.push('· 这里给出的是统计量与检索到的原文，不是成因。若出现「X 与 Y 同向」，那指的是在这批数据里同时出现，不等于谁引起谁。');
      longLines.push('· 涉及健康的部分不代表专业判断；读数异常请找医生，而不是找我复核。');
    }

    var ex = MH.xai.compose({
      short: short,
      medium: mediumLines.join('\n'),
      long: longLines.join('\n'),
      evidence: found
        ? stats.map(function (s) { return s.text; })
          .concat(quotes.slice(0, 3).map(function (q) { return '原文「' + q.text + '」—— ' + q.source; }))
        : [],
      basis: null,
      tags: ['本地检索', '统计推断'].concat(payload.context.usedSources.slice(0, 3))
    }, { level: MH.xai.defaultLevel() });

    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          text: ex.text,
          layers: ex,
          mode: 'local',
          tags: ex.tags,
          crisis: false,
          payload: payload
        });
      }, 220);
    });
  }

  function sanitizeContext(c) {
    if (!c || typeof c !== 'object') return { text: '', usedSources: [], charCount: 0 };
    return {
      text: String(c.text || '').slice(0, 24000),
      usedSources: (Array.isArray(c.usedSources) ? c.usedSources : []).map(function (s) { return String(s).slice(0, 120); }),
      charCount: Number(c.charCount) || 0
    };
  }

  function sanitizeFact(f) {
    if (!f || typeof f !== 'object') return { type: 'quote', text: '', source: '' };
    return {
      type: f.type === 'stat' ? 'stat' : (f.type === 'memory' ? 'memory' : 'quote'),
      text: String(f.text || '').slice(0, 400),
      source: String(f.source || '').slice(0, 120)
    };
  }

  /** 只保留摘要中的聚合字段，确保不含任何原始明细。 */
  function sanitizeSummary(s) {
    if (!s || typeof s !== 'object') return null;
    if (s.schema !== 'moodhub.summary/v1') return null;
    var out = { schema: s.schema, windowDays: s.windowDays, from: s.from, to: s.to, daysWithData: s.daysWithData, metrics: {} };
    ['mood', 'sleep', 'heartRate', 'stress'].forEach(function (k) {
      var m = s.metrics && s.metrics[k];
      if (!m) return;
      out.metrics[k] = {
        mean: m.mean,
        min: m.min,
        max: m.max,
        latest: m.latest,
        trend: m.trend ? { direction: m.trend.direction, changePerWeek: m.trend.changePerWeek, label: m.trend.label } : null
      };
    });
    return out;
  }

  MH.localService = {
    id: 'local-companion',
    endpoint: 'local://moodhub/companion',
    transport: 'in-process',
    description: '本页进程内的规则引擎，无网络出口；入参只接受最近 14 天统计摘要与当前这句话。',
    generateReply: generateReply,
    generateAnswer: generateAnswer,
    isCrisis: function (text) { return CRISIS_RE.test(String(text || '')); },
    resources: CRISIS_RESOURCES
  };

  MH.CRISIS_RESOURCES = CRISIS_RESOURCES;
})(window.MH = window.MH || {});
