import { Chess } from "chess.js";

const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
const ANNOTATION_NAGS = { "!": "$1", "?": "$2", "!!": "$3", "??": "$4", "!?": "$5", "?!": "$6" };

function positionKey(fen) {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 6) throw new Error("FEN non valida.");
  // Il contatore delle 50 mosse fa parte dello stato; il numero di mossa no.
  return fields.slice(0, 5).join(" ");
}

function tokenizeMovetext(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === ";") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "{") {
      index += 1;
      let comment = "";
      while (index < source.length && source[index] !== "}") comment += source[index++];
      if (source[index] === "}") index += 1;
      tokens.push({ type: "comment", value: comment.trim() });
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: char === "(" ? "open" : "close" });
      index += 1;
      continue;
    }

    const start = index;
    while (index < source.length && !/[\s(){};]/.test(source[index])) index += 1;
    let value = source.slice(start, index);
    if (!value) { index += 1; continue; }

    const moveNumber = value.match(/^(\d+)\.(\.\.)?(.*)$/);
    if (moveNumber) {
      tokens.push({ type: "moveNumber" });
      value = moveNumber[3];
      if (!value) continue;
    }
    if (/^\$\d+$/.test(value)) {
      tokens.push({ type: "nag", value });
      continue;
    }
    if (RESULT_TOKENS.has(value)) {
      tokens.push({ type: "result", value });
      continue;
    }
    if (value === "e.p." || value === "ep") continue;

    const annotation = value.match(/(!!|\?\?|!?\?|\?!|!|\?)$/);
    let nag = null;
    if (annotation) {
      nag = ANNOTATION_NAGS[annotation[0]] || null;
      value = value.slice(0, -annotation[0].length);
    }
    if (value) tokens.push({ type: "move", value, nag });
  }
  return tokens;
}

function parseHeaders(pgn) {
  const headers = {};
  const body = pgn.replace(/^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\]\s*$/gm, (_line, key, value) => {
    headers[key] = value;
    return "";
  });
  return { headers, body };
}

function escapeHeader(value) {
  return String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\"');
}

function moveUci(move) {
  return move.from + move.to + (move.promotion || "");
}

function moveFromUci(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length > 4 ? { promotion: uci[4] } : {}),
  };
}

function moveNumberPrefix(chess) {
  const fullmove = Number(chess.fen().split(/\s+/)[5]) || 1;
  return chess.turn() === "w" ? fullmove + "." : fullmove + "...";
}

function formatComment(comment) {
  if (!comment) return "";
  return " {" + String(comment).replace(/[{}]/g, " ").trim() + "}";
}

export class RepertoireTree {
  constructor(rootFen = new Chess().fen(), headers = {}) {
    this.rootFen = rootFen;
    this.headers = { ...headers };
    this.nodes = new Map();
    this.edges = new Map();
    this.rootId = this.ensureNode(rootFen).id;
  }

  ensureNode(fen) {
    const key = positionKey(fen);
    const existing = this.nodes.get(key);
    if (existing) return existing;
    const node = { id: key, key, fen, incoming: [], outgoing: [] };
    this.nodes.set(key, node);
    return node;
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  getEdge(id) {
    return this.edges.get(id) || null;
  }

  getOutgoing(nodeId) {
    const node = this.getNode(nodeId);
    return node ? node.outgoing.map((id) => this.edges.get(id)).filter(Boolean) : [];
  }

  getIncoming(nodeId) {
    const node = this.getNode(nodeId);
    return node ? node.incoming.map((id) => this.edges.get(id)).filter(Boolean) : [];
  }

  addMove(fromNodeId, move, targetFen, metadata = {}) {
    const from = this.getNode(fromNodeId);
    if (!from) throw new Error("Il nodo di partenza non esiste.");
    const uci = moveUci(move);
    const id = fromNodeId + "|" + uci;
    const target = this.ensureNode(targetFen);
    let edge = this.edges.get(id);
    if (edge) {
      if (metadata.comment && !edge.comment) edge.comment = metadata.comment;
      if (metadata.nag && !edge.nags.includes(metadata.nag)) edge.nags.push(metadata.nag);
      return edge;
    }
    edge = {
      id,
      from: fromNodeId,
      to: target.id,
      uci,
      san: move.san,
      nags: metadata.nag ? [metadata.nag] : [],
      comment: metadata.comment || "",
    };
    this.edges.set(id, edge);
    from.outgoing.push(id);
    target.incoming.push(id);
    return edge;
  }

  nodeAtPath(edgeIds, ply = edgeIds.length) {
    let nodeId = this.rootId;
    for (const edgeId of edgeIds.slice(0, ply)) {
      const edge = this.getEdge(edgeId);
      if (!edge || edge.from !== nodeId) throw new Error("Percorso delle varianti non valido.");
      nodeId = edge.to;
    }
    return nodeId;
  }

  replayPath(edgeIds) {
    const chess = new Chess(this.rootFen);
    const states = [chess.fen()];
    const moves = [];
    let nodeId = this.rootId;
    for (const edgeId of edgeIds) {
      const edge = this.getEdge(edgeId);
      if (!edge || edge.from !== nodeId) throw new Error("Percorso delle varianti non valido.");
      const move = chess.move(moveFromUci(edge.uci));
      if (!move) throw new Error("Mossa non più legale nel percorso: " + edge.san);
      moves.push(move);
      states.push(chess.fen());
      nodeId = edge.to;
    }
    return { states, moves, nodeId };
  }

  preferredPathFrom(nodeId, maxDepth = 512) {
    const path = [];
    const seen = new Set();
    let current = nodeId;
    while (path.length < maxDepth && !seen.has(current)) {
      seen.add(current);
      const edge = this.getOutgoing(current)[0];
      if (!edge) break;
      path.push(edge.id);
      current = edge.to;
    }
    return path;
  }

  mainlinePath(maxDepth = 512) {
    return this.preferredPathFrom(this.rootId, maxDepth);
  }

  static fromPgn(pgn) {
    const { headers, body } = parseHeaders(String(pgn || ""));
    const startFen = headers.SetUp === "1" && headers.FEN ? headers.FEN : new Chess().fen();
    const tree = new RepertoireTree(startFen, headers);
    const tokens = tokenizeMovetext(body);
    let currentNodeId = tree.rootId;
    let currentFen = startFen;
    let lastMoveStartNode = null;
    let lastMoveStartFen = null;
    let lastEdge = null;
    let pendingComment = "";
    const stack = [];

    for (const token of tokens) {
      if (token.type === "moveNumber" || token.type === "result") continue;
      if (token.type === "comment") {
        if (lastEdge) lastEdge.comment = [lastEdge.comment, token.value].filter(Boolean).join("\n");
        else pendingComment = [pendingComment, token.value].filter(Boolean).join("\n");
        continue;
      }
      if (token.type === "nag") {
        if (lastEdge && !lastEdge.nags.includes(token.value)) lastEdge.nags.push(token.value);
        continue;
      }
      if (token.type === "open") {
        if (!lastMoveStartNode) throw new Error("Variante PGN senza una mossa precedente.");
        stack.push({
          currentNodeId,
          currentFen,
          lastMoveStartNode,
          lastMoveStartFen,
          lastEdge,
        });
        currentNodeId = lastMoveStartNode;
        currentFen = lastMoveStartFen;
        lastMoveStartNode = null;
        lastMoveStartFen = null;
        lastEdge = null;
        pendingComment = "";
        continue;
      }
      if (token.type === "close") {
        const parent = stack.pop();
        if (!parent) throw new Error(" parentesi di variante PGN non bilanciata.");
        currentNodeId = parent.currentNodeId;
        currentFen = parent.currentFen;
        lastMoveStartNode = parent.lastMoveStartNode;
        lastMoveStartFen = parent.lastMoveStartFen;
        lastEdge = parent.lastEdge;
        pendingComment = "";
        continue;
      }
      if (token.type === "move") {
        const chess = new Chess(currentFen);
        let move;
        try {
          move = chess.move(token.value);
        } catch {
          move = null;
        }
        if (!move) throw new Error("Mossa PGN non valida: " + token.value);
        lastMoveStartNode = currentNodeId;
        lastMoveStartFen = currentFen;
        const edge = tree.addMove(currentNodeId, move, chess.fen(), {
          comment: pendingComment,
          nag: token.nag,
        });
        pendingComment = "";
        currentNodeId = edge.to;
        currentFen = chess.fen();
        lastEdge = edge;
      }
    }
    if (stack.length) throw new Error(" parentesi di variante PGN non chiusa.");
    return tree;
  }

  toPgn(extraHeaders = {}) {
    const headers = { ...this.headers, ...extraHeaders };
    const hasNonStandardStart = this.rootFen !== new Chess().fen();
    if (hasNonStandardStart) {
      headers.SetUp = "1";
      headers.FEN = this.rootFen;
    }
    if (!headers.Event) headers.Event = "Chess OS repertoire";
    if (!headers.Result) headers.Result = "*";

    const renderFrom = (nodeId, fen, ancestry = new Set()) => {
      if (ancestry.has(nodeId)) return "";
      const edges = this.getOutgoing(nodeId);
      if (!edges.length) return "";
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(nodeId);
      const main = edges[0];
      const chess = new Chess(fen);
      const move = chess.move(moveFromUci(main.uci));
      if (!move) return "";
      const token = moveNumberPrefix(new Chess(fen)) + " " + move.san
        + (main.nags.length ? " " + main.nags.join(" ") : "")
        + formatComment(main.comment);
      const variations = edges.slice(1).map((edge) => {
        const variation = renderEdge(edge, fen, nextAncestry);
        return variation ? "(" + variation + ")" : "";
      }).filter(Boolean);
      const continuation = renderFrom(main.to, chess.fen(), nextAncestry);
      return [token, ...variations, continuation].filter(Boolean).join(" ");
    };

    const renderEdge = (edge, fen, ancestry) => {
      const chess = new Chess(fen);
      const move = chess.move(moveFromUci(edge.uci));
      if (!move) return "";
      const token = moveNumberPrefix(new Chess(fen)) + " " + move.san
        + (edge.nags.length ? " " + edge.nags.join(" ") : "")
        + formatComment(edge.comment);
      return [token, renderFrom(edge.to, chess.fen(), ancestry)].filter(Boolean).join(" ");
    };

    const headerText = Object.entries(headers)
      .map(([key, value]) => "[" + key + ' "' + escapeHeader(value) + '"]')
      .join("\n");
    const movetext = renderFrom(this.rootId, this.rootFen);
    return headerText + "\n\n" + (movetext || "*") + (movetext ? " " + headers.Result : "");
  }
}

export function parseRepertoirePgn(pgn) {
  return RepertoireTree.fromPgn(pgn);
}
