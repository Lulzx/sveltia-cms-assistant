// The Yoast-style analysis behind the editor's SEO panel: what a post
// scores, and why. No DOM and no network — everything here is a pure
// function of the entry draft, so panel.js can re-run it on every keystroke.
//
// The checks follow Yoast's published thresholds where they are public
// (title 30-60 chars, description 120-156, density 0.5-3%, 300-word minimum,
// 25-word sentences, 10% passive, 30% transitions, 300 words per subheading).
// The scoring is ours: two points for a green check, one for orange.
//
// Site specifics (field names, title suffix, which hosts are internal) come
// from config.js. Loaded after it; exposed as window.CMSAssistant.analysis.

(function () {
  var config = window.CMSAssistant.config;
  var FIELDS = config.fields;

  // ---------------------------------------------------------------- text

  /** Strip markdown syntax so word counts and matches see prose only. */
  function stripMarkdown(md) {
    return String(md || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}>\s?/gm, "")
      // A heading ends its own sentence, or it runs into the paragraph below
      // it and every sentence-level check reads one long sentence.
      .replace(/^\s{0,3}#{1,6}\s+(.*?)[.:]?\s*$/gm, "$1.")
      .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_~]{1,3}/g, "")
      .replace(/<[^>]+>/g, " ");
  }

  /** Lowercase, drop accents and punctuation: the form every match uses. */
  function normalize(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function words(text) {
    var n = normalize(text);
    return n ? n.split(" ") : [];
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Occurrences of the normalized phrase in normalized text, whole words. */
  function countPhrase(text, phrase) {
    if (!phrase) return 0;
    var haystack = " " + normalize(text) + " ";
    var needle = " " + phrase + " ";
    var count = 0;
    var from = 0;
    var at;
    // Overlapping matches are not a thing for a keyphrase, so step past each.
    while ((at = haystack.indexOf(needle, from)) !== -1) {
      count += 1;
      from = at + needle.length - 1;
    }
    return count;
  }

  function hasPhrase(text, phrase) {
    return countPhrase(text, phrase) > 0;
  }

  /** Every word of the phrase somewhere in the text, order ignored. */
  function hasAllWords(text, phrase) {
    if (!phrase) return false;
    var pool = words(text);
    return phrase.split(" ").every(function (word) {
      return pool.indexOf(word) !== -1;
    });
  }

  function sentences(text) {
    return String(text || "")
      .split(/(?<=[.!?\u2026])[\s\u00a0]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return words(s).length > 0;
      });
  }

  function countSyllables(word) {
    var w = word.replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    var groups = w.match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
  }

  // ------------------------------------------------------------- lexicon

  var TRANSITIONS = [
    "accordingly", "additionally", "also", "although", "as a result", "at the same time",
    "because", "before", "besides", "but", "by contrast", "certainly", "consequently",
    "conversely", "even so", "even though", "finally", "first", "for example",
    "for instance", "fortunately", "furthermore", "hence", "however", "in addition",
    "in contrast", "in fact", "in other words", "in particular", "in short", "in summary",
    "indeed", "instead", "later", "likewise", "meanwhile", "moreover", "nevertheless",
    "next", "nonetheless", "of course", "on the contrary", "on the other hand",
    "otherwise", "overall", "rather", "second", "similarly", "since", "so", "still",
    "that is", "then", "therefore", "though", "thus", "to sum up", "unless", "unlike",
    "until", "what is more", "whereas", "while", "yet",
  ];

  var IRREGULAR_PARTICIPLES = [
    "known", "made", "given", "taken", "seen", "done", "shown", "found", "held",
    "written", "built", "sold", "kept", "left", "paid", "put", "read", "set", "sent",
    "told", "thought", "brought", "bought", "caught", "chosen", "driven", "eaten",
    "fallen", "felt", "grown", "heard", "lost", "meant", "met", "run", "said", "spent",
    "stood", "understood", "worn", "won", "cut", "hit", "let", "shut", "split", "spread",
  ];

  var PASSIVE = new RegExp(
    "\\b(?:am|is|are|was|were|be|been|being|get|gets|got|gotten)\\b\\s+(?:\\w+\\s+){0,1}" +
      "\\b(?:\\w+ed|" + IRREGULAR_PARTICIPLES.join("|") + ")\\b",
    "i",
  );

  // -------------------------------------------------------------- checks

  var GOOD = "good";
  var OK = "ok";
  var BAD = "bad";

  function check(status, text) {
    // `field` says which half of a fix a check belongs to: the metadata call
    // or the body call. Most checks are about the body, and analyseSeo tags
    // the ones that are not.
    return { status: status, text: text, field: "body" };
  }

  /** Tag everything pushed since `from` and return the new high-water mark. */
  function tagFrom(results, from, field) {
    for (var i = from; i < results.length; i += 1) results[i].field = field;
    return results.length;
  }

  function analyseSeo(post) {
    var phrase = post.phrase;
    var results = [];
    var mark = 0;

    if (!phrase) {
      results.push(check(BAD, "No focus keyphrase set. Enter the phrase you want this post to rank for."));
    } else {
      var phraseWords = phrase.split(" ").length;
      results.push(
        phraseWords > 6
          ? check(OK, "The keyphrase is " + phraseWords + " words long. Long phrases are rarely searched for as written.")
          : check(GOOD, "Focus keyphrase set: “" + phrase + "”."),
      );
    }

    mark = tagFrom(results, mark, "keyphrase");

    // Title, as it is actually rendered in the <title> tag.
    var titleLength = post.renderedTitle.length;
    if (!post.title) {
      results.push(check(BAD, "The post has no title."));
    } else if (titleLength < 30) {
      results.push(check(OK, "The page title is " + titleLength + " characters. Below 30 it wastes room in the result."));
    } else if (titleLength > config.titleLimit) {
      results.push(check(BAD, "The page title is " + titleLength + " characters. Google truncates past about " + config.titleLimit + "."));
    } else {
      results.push(check(GOOD, "The page title is " + titleLength + " characters — a good length."));
    }

    if (phrase && post.title) {
      if (hasPhrase(post.title, phrase)) {
        var head = normalize(post.title).indexOf(phrase) === 0;
        results.push(
          head
            ? check(GOOD, "The title opens with the keyphrase.")
            : check(OK, "The title contains the keyphrase, but not at the start. Earlier carries more weight."),
        );
      } else if (hasAllWords(post.title, phrase)) {
        results.push(check(OK, "The title has every word of the keyphrase, but not as one phrase."));
      } else {
        results.push(check(BAD, "The keyphrase does not appear in the title."));
      }
    }

    mark = tagFrom(results, mark, "title");

    // Meta description.
    var descLength = post.description.length;
    if (!descLength) {
      results.push(check(BAD, "No meta description. It is the snippet under your result — write one."));
    } else if (descLength < 120) {
      results.push(check(OK, "The meta description is " + descLength + " characters. There is room for up to 156."));
    } else if (descLength > 156) {
      results.push(check(BAD, "The meta description is " + descLength + " characters and will be cut off around 156."));
    } else {
      results.push(check(GOOD, "The meta description is " + descLength + " characters — a good length."));
    }

    if (phrase && descLength) {
      results.push(
        hasPhrase(post.description, phrase)
          ? check(GOOD, "The keyphrase appears in the meta description.")
          : check(BAD, "The keyphrase is missing from the meta description."),
      );
    }

    mark = tagFrom(results, mark, "description");

    // Slug.
    if (phrase) {
      results.push(
        hasPhrase(post.slug.replace(/-/g, " "), phrase)
          ? check(GOOD, "The keyphrase is in the URL slug.")
          : hasAllWords(post.slug.replace(/-/g, " "), phrase)
            ? check(OK, "The slug has the keyphrase words but not in order.")
            : check(BAD, "The keyphrase is not in the URL slug (" + config.postUrl(post.slug) + ")."),
      );
    }

    mark = tagFrom(results, mark, "slug");

    // Body length.
    var wordCount = post.wordCount;
    if (wordCount < 300) {
      results.push(check(BAD, "The post is " + wordCount + " words. Aim for at least 300."));
    } else if (wordCount < 600) {
      results.push(check(OK, "The post is " + wordCount + " words. Longer guides tend to rank better."));
    } else {
      results.push(check(GOOD, "The post is " + wordCount + " words."));
    }

    if (phrase && wordCount) {
      // First paragraph — the introduction, in Yoast's terms.
      results.push(
        hasPhrase(post.firstParagraph, phrase) || hasAllWords(post.firstParagraph, phrase)
          ? check(GOOD, "The keyphrase appears in the opening paragraph.")
          : check(BAD, "The keyphrase is missing from the opening paragraph."),
      );

      // Subheadings.
      if (!post.headings.length) {
        results.push(check(BAD, "The post has no subheadings. Break it up with ## headings."));
      } else {
        var withPhrase = post.headings.filter(function (heading) {
          return hasPhrase(heading, phrase) || hasAllWords(heading, phrase);
        }).length;
        results.push(
          withPhrase === 0
            ? check(BAD, "None of the " + post.headings.length + " subheadings contain the keyphrase.")
            : check(GOOD, withPhrase + " of " + post.headings.length + " subheadings contain the keyphrase."),
        );
      }

      // Density.
      var occurrences = post.phraseCount;
      var density = wordCount ? (occurrences / wordCount) * 100 : 0;
      var densityText = density.toFixed(1) + "% (" + occurrences + "×)";
      if (density < 0.5) {
        results.push(check(BAD, "Keyphrase density is " + densityText + ". That is thin — aim for 0.5–3%."));
      } else if (density > 3) {
        results.push(check(BAD, "Keyphrase density is " + densityText + ". That reads as stuffing — stay under 3%."));
      } else {
        results.push(check(GOOD, "Keyphrase density is " + densityText + " — in range."));
      }
    }

    // Images.
    var images = post.images;
    if (!images.length && !post.cover) {
      results.push(check(OK, "The post has no images. One picture makes the page easier to scan and to share."));
    } else {
      var missingAlt = images.filter(function (image) {
        return !image.alt.trim();
      }).length;
      if (post.cover && !post.coverAlt.trim()) missingAlt += 1;
      if (missingAlt) {
        results.push(check(BAD, missingAlt + " image" + (missingAlt === 1 ? " has" : "s have") + " no alt text."));
      } else if (phrase) {
        var altText = images
          .map(function (image) {
            return image.alt;
          })
          .concat([post.coverAlt])
          .join(" ");
        results.push(
          hasPhrase(altText, phrase) || hasAllWords(altText, phrase)
            ? check(GOOD, "Every image has alt text and the keyphrase appears in it.")
            : check(OK, "Every image has alt text, but none of it mentions the keyphrase."),
        );
      } else {
        results.push(check(GOOD, "Every image has alt text."));
      }
    }

    // Links.
    results.push(
      post.internalLinks
        ? check(GOOD, post.internalLinks + " internal link" + (post.internalLinks === 1 ? "" : "s") + " to other " + config.site.name + " pages.")
        : check(BAD, "No internal links. Link to a related post or another page on the site."),
    );
    results.push(
      post.externalLinks
        ? check(GOOD, post.externalLinks + " outbound link" + (post.externalLinks === 1 ? "" : "s") + " to sources.")
        : check(OK, "No outbound links. Citing a source is a trust signal."),
    );

    return results;
  }

  function analyseReadability(post) {
    var results = [];
    var all = post.sentences;

    if (!all.length) {
      return [check(BAD, "There is no body text to read yet.")];
    }

    // Sentence length.
    var long = all.filter(function (sentence) {
      return words(sentence).length > 25;
    });
    var longShare = (long.length / all.length) * 100;
    results.push(
      longShare <= 25
        ? check(GOOD, longShare.toFixed(0) + "% of sentences run over 25 words — under the 25% limit.")
        : check(BAD, longShare.toFixed(0) + "% of sentences run over 25 words. Shorten some; the limit is 25%."),
    );

    // Paragraph length.
    var longParagraphs = post.paragraphs.filter(function (paragraph) {
      return words(paragraph).length > 150;
    });
    results.push(
      longParagraphs.length
        ? check(BAD, longParagraphs.length + " paragraph" + (longParagraphs.length === 1 ? " is" : "s are") + " over 150 words. Split them.")
        : check(GOOD, "No paragraph runs past 150 words."),
    );

    // Subheading distribution.
    var longSection = post.sections.filter(function (section) {
      return words(section).length > 300;
    });
    results.push(
      longSection.length
        ? check(BAD, longSection.length + " stretch" + (longSection.length === 1 ? "" : "es") + " of over 300 words has no subheading.")
        : check(GOOD, "Subheadings are spread through the text."),
    );

    // Passive voice.
    var passive = all.filter(function (sentence) {
      return PASSIVE.test(sentence);
    });
    var passiveShare = (passive.length / all.length) * 100;
    results.push(
      passiveShare <= 10
        ? check(GOOD, passiveShare.toFixed(0) + "% of sentences use the passive voice — under the 10% limit.")
        : check(BAD, passiveShare.toFixed(0) + "% of sentences use the passive voice. Try to stay under 10%."),
    );

    // Transition words.
    var transitional = all.filter(function (sentence) {
      var normalized = " " + normalize(sentence) + " ";
      return TRANSITIONS.some(function (word) {
        return new RegExp("(?:^| )" + escapeRegExp(word) + "(?: |$)").test(normalized);
      });
    });
    var transitionShare = (transitional.length / all.length) * 100;
    results.push(
      transitionShare >= 30
        ? check(GOOD, transitionShare.toFixed(0) + "% of sentences carry a transition word.")
        : transitionShare >= 20
          ? check(OK, transitionShare.toFixed(0) + "% of sentences carry a transition word. 30% reads more fluently.")
          : check(BAD, "Only " + transitionShare.toFixed(0) + "% of sentences carry a transition word; aim for 30%."),
    );

    // Consecutive sentences opening with the same word.
    var runs = 0;
    var run = 1;
    for (var i = 1; i < all.length; i += 1) {
      var previous = words(all[i - 1])[0];
      var current = words(all[i])[0];
      if (previous && current && previous === current) {
        run += 1;
        if (run === 3) runs += 1;
      } else {
        run = 1;
      }
    }
    results.push(
      runs
        ? check(BAD, runs + " place" + (runs === 1 ? "" : "s") + " where three sentences in a row start with the same word.")
        : check(GOOD, "No three sentences in a row open with the same word."),
    );

    // Flesch reading ease.
    var wordList = post.words;
    var syllables = wordList.reduce(function (total, word) {
      return total + countSyllables(word);
    }, 0);
    var ease = 206.835 - 1.015 * (wordList.length / all.length) - 84.6 * (syllables / (wordList.length || 1));
    var rounded = Math.max(0, Math.min(100, ease)).toFixed(0);
    results.push(
      ease >= 60
        ? check(GOOD, "Flesch reading ease " + rounded + " — plain enough for a general reader.")
        : ease >= 50
          ? check(OK, "Flesch reading ease " + rounded + ". Slightly heavy going; shorter words would help.")
          : check(BAD, "Flesch reading ease " + rounded + ". This reads as hard work — simplify."),
    );

    return results;
  }

  /** Yoast's traffic light: two points for green, one for orange. */
  function score(results) {
    if (!results.length) return 0;
    var earned = results.reduce(function (total, result) {
      return total + (result.status === GOOD ? 2 : result.status === OK ? 1 : 0);
    }, 0);
    return Math.round((earned / (results.length * 2)) * 100);
  }

  function scoreStatus(value) {
    return value >= 80 ? GOOD : value >= 55 ? OK : BAD;
  }

  // ---------------------------------------------------------------- post

  /** Everything the checks need, read once out of the entry draft. */
  function readPost(entry, phrase) {
    var data = entry && entry.get ? entry.get("data") : null;
    var get = function (key) {
      var value = data && data.get ? data.get(key) : "";
      return value == null ? "" : String(value);
    };

    var body = get(FIELDS.body);
    var prose = stripMarkdown(body);
    // Tags arrive as an Immutable List; anything else (unset, a stray string)
    // is read as no tags.
    var rawTags = data && data.get ? data.get(FIELDS.tags) : null;
    var tags = rawTags && typeof rawTags.toArray === "function" ? rawTags.toArray() : [];
    tags = tags
      .map(function (tag) {
        return tag == null ? "" : String(tag).trim();
      })
      .filter(Boolean);
    var title = get(FIELDS.title);
    var slug =
      (entry && entry.get && entry.get("slug")) ||
      normalize(title).replace(/\s+/g, "-");

    var images = [];
    body.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, function (_match, alt, src) {
      images.push({ alt: alt, src: src });
      return "";
    });

    var internalLinks = 0;
    var externalLinks = 0;
    body.replace(/(?<!!)\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, function (_match, href) {
      if (config.isInternalLink(href)) internalLinks += 1;
      else externalLinks += 1;
      return "";
    });

    // Blocks that are prose: not headings, fences, lists or quotes.
    var paragraphs = body
      .replace(/```[\s\S]*?```/g, "")
      .split(/\n\s*\n/)
      .map(function (block) {
        return block.trim();
      })
      .filter(function (block) {
        return block && !/^(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|\||!\[)/.test(block);
      })
      .map(stripMarkdown);

    var headings = [];
    body.replace(/^\s{0,3}(#{2,6})\s+(.+)$/gm, function (_match, _hashes, text) {
      headings.push(text.trim());
      return "";
    });

    // The runs of text between subheadings, for the distribution check.
    var sections = body
      .split(/^\s{0,3}#{2,6}\s+.+$/gm)
      .map(stripMarkdown)
      .filter(function (section) {
        return section.trim();
      });

    return {
      phrase: normalize(phrase),
      title: title,
      renderedTitle: title ? title + config.site.titleSuffix : "",
      description: get(FIELDS.description),
      cover: get(FIELDS.cover),
      coverAlt: get(FIELDS.coverAlt),
      tags: tags,
      slug: slug,
      body: body,
      prose: prose,
      words: words(prose),
      wordCount: words(prose).length,
      phraseCount: countPhrase(prose, normalize(phrase)),
      firstParagraph: paragraphs[0] || "",
      paragraphs: paragraphs,
      headings: headings,
      sections: sections,
      sentences: sentences(prose),
      images: images,
      internalLinks: internalLinks,
      externalLinks: externalLinks,
    };
  }

  window.CMSAssistant.analysis = {
    GOOD: GOOD,
    OK: OK,
    BAD: BAD,
    stripMarkdown: stripMarkdown,
    normalize: normalize,
    words: words,
    countPhrase: countPhrase,
    hasPhrase: hasPhrase,
    hasAllWords: hasAllWords,
    analyseSeo: analyseSeo,
    analyseReadability: analyseReadability,
    score: score,
    scoreStatus: scoreStatus,
    readPost: readPost,
  };
})();
