const path = require('path')
const https = require('https');
const express = require('express');
const multer = require('multer');
const fs = require('fs');

const app = express();
const upload = multer();


const privateKey = fs.readFileSync('ssl/private.key', 'utf8');
const certificate = fs.readFileSync('ssl/certificate.crt', 'utf8');
const intermediateCertificate = fs.readFileSync('ssl/intermediate.crt', 'utf8');
const rootCertificate = fs.readFileSync('ssl/root.crt', 'utf8');
const credentials = {
  key: privateKey,
  cert: certificate,
  ca: [intermediateCertificate, rootCertificate]
};

let authorizationKey;

async function updateAuthorizationKey() {
  try {
    const res = await getAuthorizationKey();
    const data = await res.json();
    authorizationKey = "Bearer " + data.content.token;
  } catch (error) {
    console.error("Error updating authorization key:", error);
  }
}

updateAuthorizationKey();

setInterval(updateAuthorizationKey, 172800000);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/uploadImage', upload.single('image'), async (req, res) => {
  try {
    var solutionsPreviews = (await getSolutionsPreviews(req).then(res => res.json())).preview
    console.log(JSON.stringify(solutionsPreviews))
    res.status(200).send(parseSolutionsPreviews(solutionsPreviews));
  } catch (error) {
    res.status(500).send({ error: 'Server error', message: error.message });
  }
});

app.post('/getDetailedSolution', async (req, res) => {
  try {
    var nodeAction = req.body;
    var detailedSolution = await getDetailedSolution(nodeAction).then(res => res.json());
    res.status(200).send(parseDetailedSolution(detailedSolution));
  } catch (error) {
    res.status(500).send({ error: 'Server error', message: error.message });
  }
})

https.createServer(credentials, app).listen(443, () => {
  console.log('HTTPS Server running on port 443');
});

function getAuthorizationKey() {
  return fetch('https://lapi.photomath.net/v5/me', {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiYjJhMjg0Zi03NGU2LTQwNGItODM5Ny00MDYyNTNlYTU0NzIiLCJhdWQiOiJwaG90b21hdGgiLCJuYmYiOjE3MTAyNTg1MjgsInNjb3BlIjpbInJlZnJlc2giXSwiaXNzIjoiaHR0cHM6Ly9sYXBpLnBob3RvbWF0aC5uZXQvdjUiLCJyb2xlc0tleSI6InNjb3BlIiwiZXhwIjoxNzI1ODEwNTI4LCJpYXQiOjE3MTAyNTg1Mjh9.xehqXm1W0vjXNg2QoiUkIX66CsEPgJ-nKPv_ZvY7PDM',
    }
  });
}

function getSolutionsPreviews(req) {
  const { file, body } = req;
  const { width, height } = body;
  const processImageUrl = 'https://rapi.photomath.net/v1/process-image-groups?locale=ru';
  const json = {
    "metadata": {
      "appLanguage": "ru"
    },
    "experiments": {
      "italianMonetization":
        "Variant1", "spanishMonetization":
        "Variant2", "portugueseMonetization": false
    },
    "animatedPreview": true,
    "view": {
      "y": 0, "x": 0,
      "width": parseInt(width),
      "height": parseInt(height)
    },
    "ordering": {
      "preferredMulType": "vertical",
      "preferredDivType": "horizontal"
    }
  }
  const form = new FormData();
  var blob = new Blob([file.buffer], { type: 'image/jpeg' });
  form.append('image', blob, {
    type: 'image/jpeg',
    name: 'image',
  });
  form.append('json', new Blob([JSON.stringify(json)], { type: 'application/json' }));
  const headers = {
    "authorization": authorizationKey
  };
  return fetch(processImageUrl, {
    method: 'POST',
    headers: headers,
    body: form
  });
}

function getDetailedSolution(nodeAction) {
  const url = 'https://rapi.photomath.net/v1/process-command?locale=ru';
  const headers = {
    "content-type": "application/json",
    "authorization": authorizationKey
  };
  let body = {
    "action": nodeAction.action,
    "experiments": {
      "italianMonetization": "Variant1",
      "spanishMonetization": "Variant2",
      "portugueseMonetization": false
    },
    "node": nodeAction.node,
    "ordering": {
      "preferredMulType": "vertical",
      "preferredDivType": "horizontal"
    }
  }
  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  })
}

function parseSolutionsPreviews(solutions) {
  const groups = solutions.groups;
  return groups.flatMap(group => {
    if (group.type === "vertical") {
      return group.entries.map(entry => {
        const a = entry.preview;
        return {
          title: replaceArgs(a.title.localizedText.text, a.title.args),
          method: replaceArgs(a.method.localizedText.text, a.method.args),
          problem: convertNodeToLatex(a.content.problem),
          solution: convertNodeToLatex(a.content.solution),
          nodeAction: entry.nodeAction,
        };
      });
    }
  }).filter(x => x);
}

function parseDetailedSolution(solution) {
  const detailedSolution = solution.result.steps.map(step => {
    const math = convertNodeToLatex(step.substeps[0].left)
    const header = replaceArgs(step.headers[0].localizedText.text, step.headers[0].args)
    return { 
      step: math, 
      header: header, 
     }
  })
  detailedSolution.push({ step: convertNodeToLatex(solution.result.solution), header: "Ответ" });
  return detailedSolution;
}

function replaceArgs(text, args) {
  for (var i = 0; i < args.length; i++) {
    var argVal = convertNodeToLatex(args[i]);
    text = text.replace('ARG' + (i + 1), argVal);
  }
  return text
}

function convertNodeToLatex(node) {
  const operations = {
    string: node => `\\text{${node.value}}`,
    localized_text: node => {
      const text = node.children[2].value;
      const args = node.children.slice(3);
      const res = replaceArgs(text, args).replace(/(\\\(.+?\\\)|[^\\]+)/g, (match, p1) => {
        if (p1.startsWith('\\(') && p1.endsWith('\\)')) {
          return p1;
        }
        return "\\text{" + p1 + "}";
      }).replace(/\\\(|\\\)/g, "");
      return res
    },
    var: node => node.value.replace(/_(\d+)/g, '_{$1}'),
    unit: node => `\\text{ ${node.value}}`,
    indexed: node => `${parseLatex(node.children[0])}_{${parseLatex(node.children[1])}}`,
    const: node => node.value.replace('.', '{,}'),
    periodic_localize: node => periodicLocalize(node),
    negative: node => `-${parseLatex(node.children[0])}`,
    positive: node => `+${parseLatex(node.children[0])}`,
    equals: node => `${parseLatex(node.children[0])}=${parseLatex(node.children[1])}`,
    add: node => `${parseLatex(node.children[0])}+${parseLatex(node.children[1])}`,
    sub: node => `${parseLatex(node.children[0])}-${parseLatex(node.children[1])}`,
    div: node => `${parseLatex(node.children[0])}:${parseLatex(node.children[1])}`,
    mul: node => `${parseLatex(node.children[0])}\\cdot ${parseLatex(node.children[1])}`,
    muli: node => `${parseLatex(node.children[0])}${parseLatex(node.children[1])}`,
    add_sub: node => `${parseLatex(node.children[0])}\\pm ${parseLatex(node.children[1])}`,
    add_sub_sign: node => `\\pm${parseLatex(node.children[0])}`,
    frac: node => `\\frac{${parseLatex(node.children[0])}}{${parseLatex(node.children[1])}}`,
    mixedfrac: node => `${parseLatex(node.children[0])}\\frac{${parseLatex(node.children[1])}}{${parseLatex(node.children[2])}}`,
    pow: node => `${parseLatex(node.children[0])}^{${parseLatex(node.children[1])}}`,
    factorial: node => `${parseLatex(node.children[0])}!`,
    percentage: node => `${parseLatex(node.children[0])}%`,
    bracket: node => `(${parseLatex(node.children[0])})`,
    root2: node => `\\sqrt{${parseLatex(node.children[0])}}`,
    root: node => `\\sqrt[${parseLatex(node.children[0])}]{${parseLatex(node.children[1])}}`,
    log: node => `\\log_{${parseLatex(node.children[0])}}${formatExpression(node.children[1])}`,
    ln: node => `\\ln ${formatExpression(node.children[0])}`,
    abs: node => `|${parseLatex(node.children[0])}|`,
    not_equals: node => `${parseLatex(node.children[0])}\\neq ${parseLatex(node.children[1])}`,
    approx: node => `${parseLatex(node.children[0])}\\approx ${parseLatex(node.children[1])}`,
    approx_sign: node => `\\approx ${parseLatex(node.children[0])}`,
    gt: node => `${parseLatex(node.children[0])} > ${parseLatex(node.children[1])}`,
    lt: node => `${parseLatex(node.children[0])} < ${parseLatex(node.children[1])}`,
    gte: node => `${parseLatex(node.children[0])}\\geq ${parseLatex(node.children[1])}`,
    lte: node => `${parseLatex(node.children[0])}\\leq ${parseLatex(node.children[1])}`,
    //списки
    list: node => node.children.map(parseLatex).join(', '),
    alt_form: node => node.children.map(parseLatex).join('; '),
    vert_list: node => `\\begin{array}{l}${node.children.map(parseLatex).join('\\\\')}\\end{array}`,
    //тригонометрия
    deg: node => `${parseLatex(node.children[0])}^{\\circ}`,
    degmin: node => `${parseLatex(node.children[0])}^{\\circ} ${parseLatex(node.children[1])}'`,
    degminsecond: node => `${parseLatex(node.children[0])}^{\\circ} ${parseLatex(node.children[1])}' ${parseLatex(node.children[2])}''`,
    sin: node => `\\sin ${formatExpression(node.children[0])}`,
    cos: node => `\\cos ${formatExpression(node.children[0])}`,
    tan: node => `\\operatorname{tg} ${formatExpression(node.children[0])}`,
    cot: node => `\\operatorname{ctg} ${formatExpression(node.children[0])}`,
    asin: node => `\\arcsin ${formatExpression(node.children[0])}`,
    acos: node => `\\arccos ${formatExpression(node.children[0])}`,
    atan: node => `\\operatorname{arctg} ${formatExpression(node.children[0])}`,
    acot: node => `\\operatorname{arcctg} ${formatExpression(node.children[0])}`,
    sec: node => `\\sec ${formatExpression(node.children[0])}`,
    csc: node => `\\csc ${formatExpression(node.children[0])}`,
    //множества
    elem_of: node => `${parseLatex(node.children[0])}\\in ${parseLatex(node.children[1])}`,
    elem_not_of: node => `${parseLatex(node.children[0])}\\notin ${parseLatex(node.children[1])}`,
    union: node => `${parseLatex(node.children[0])}\\cup ${parseLatex(node.children[1])}`,
    ooint: node => `(${parseLatex(node.children[0])};${parseLatex(node.children[1])})`,
    coint: node => `[${parseLatex(node.children[0])};${parseLatex(node.children[1])})`,
    ocint: node => `(${parseLatex(node.children[0])};${parseLatex(node.children[1])}]`,
    ccint: node => `[${parseLatex(node.children[0])};${parseLatex(node.children[1])}]`,
    set: node => `\\{${node.children.map(child => parseLatex(child)).join(', ')}\\}`,
    order: node => `(${node.children.map(parseLatex).join(', ')})`,
    cond_def: node => `${parseLatex(node.children[0])}|${parseLatex(node.children[1])}`,
    cond_expr: node => `${parseLatex(node.children[0])}, ${parseLatex(node.children[1])}`,
    //матрицы
    //det2:
    //det3:
    //функции
    system: node => `\\begin{cases}${node.children.map(parseLatex).join(',\\\\ ') + ';'}\\end{cases}`,
    function: node => `${parseLatex(node.children[0])}(${parseLatex(node.children[1])})`,
    function_inverse: node => `${parseLatex(node.children[0])}^{-1}(${parseLatex(node.children[1])})`,
    //матанал
    derivation: node => `\\frac{d}{d${parseLatex(node.children[0])}}(${parseLatex(node.children[1])})`,
    derivationprime: node => `${parseLatex(node.children[0])}'`,
    derivationprime2: node => `${parseLatex(node.children[0])}''`,
    nderivationprime: node => `${parseLatex(node.children[1])}^{(${parseLatex(node.children[0])})}`,
    diff: node => `${parseLatex(node.children[0])}\\backslash ${parseLatex(node.children[1])}`,
    derivation_diff: node => `\\frac{d${parseLatex(node.children[0])}}{d${parseLatex(node.children[1])}}`,
    partial_derivation: node => `\\frac{\\partial}{\\partial ${parseLatex(node.children[0])}}(${parseLatex(node.children[1])})`,
    partial_derivation_diff: node => `\\frac{\\partial ${parseLatex(node.children[0])}}{\\partial ${parseLatex(node.children[1])}}`,
    lim: node => `\\lim\\limits_{${parseLatex(node.children[0])}\\to ${parseLatex(node.children[1])}} ${formatExpression(node.children[2])}`,
    definitesigma: node => `\\sum\\limits_{${parseLatex(node.children[0])}=${parseLatex(node.children[1])}}^{${parseLatex(node.children[2])}} ${parseLatex(node.children[3])}`,
    integral: node => `\\int (${parseLatex(node.children[0])}) d${parseLatex(node.children[1])}`,
    definiteintegral: node => `\\int\\limits_{${parseLatex(node.children[0])}}^{${parseLatex(node.children[1])}} (${parseLatex(node.children[2])}) d${parseLatex(node.children[3])}`,
    differential: node => `d${parseLatex(node.children[0])}`,
    integralrightdash: node => `${parseLatex(node.children[0])} \\Bigg|^${parseLatex(node.children[1])}_${parseLatex(node.children[2])}`,
    //misc
    blank_box_op: node => `${parseLatex(node.children[0])} \\ \\fbox{?}\\ ${parseLatex(node.children[1])}`,
    filled_box_lt: node => `${parseLatex(node.children[0])} < ${parseLatex(node.children[1])}`,
    filled_box_gt: node => `${parseLatex(node.children[0])} > ${parseLatex(node.children[1])}`,
    filled_box_equals: node => `${parseLatex(node.children[0])} = ${parseLatex(node.children[1])}`,
    function_operation: node => `(${parseLatex(node.children[0])})(${parseLatex(node.children[1])})`,
    composition: node => `${parseLatex(node.children[0])}\\circ ${parseLatex(node.children[1])}`,
    piecewise_def: node => `\\begin{cases}${node.children.map(parseLatex).join('\\\\ ')}\\end{cases}`,
  }
  function formatExpression(node) {
    const typesNeedingParenthesis = ['negative', 'add', 'sub', 'div', 'mul'];
    const expression = parseLatex(node);
    return typesNeedingParenthesis.includes(node.type)
      ? `(${expression})` : `${expression}`;
  }
  function periodicLocalize(node) {
    const value = parseInt(node.children[1].value);
    const decimal = node.children[0].value;
    const intPart = decimal.split('.')[0]
    const nonRepeatingPart = decimal.split('.')[1].slice(0, -value);
    const repeatingPart = decimal.split('.')[1].substr(-value);
    return `${intPart}{,}${nonRepeatingPart}(${repeatingPart})`;
  }
  function parseLatex(node) {
    return operations[node.type]
      ? operations[node.type](node)
      : JSON.stringify(node);
  }
  function postProcess(latexString) {
    const replacementMap = {
      "α": "\\alpha ",
      "β": "\\beta ",
      "γ": "\\gamma ",
      "δ": "\\delta ",
      "ε": "\\varepsilon ",
      "η": "\\eta ",
      "θ": "\\theta ",
      "λ": "\\lambda ",
      "µ": "\\mu ",
      "π": "\\pi ",
      "ρ": "\\rho ",
      "σ": "\\sigma ",
      "τ": "\\tau ",
      "Φ": "\\phi ",
      "ψ": "\\psi ",
      "ℕ": "\\mathbb{N} ",
      "ℤ": "\\mathbb{Z} ",
      "ℚ": "\\mathbb{Q} ",
      "ℝ": "\\mathbb{R} ",
      "∅": "\\varnothing ",
      "∞": "\\infty ",
      "ddfrac": "frac",
      "frac": "dfrac",
    }
    function processBrackets(str) {
      const substrings = [];
      let stack = [];
      let startIndex = null;

      for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') {
          stack.push(i);
          if (stack.length === 1) startIndex = i;
        } else if (str[i] === ')') {
          stack.pop();
          if (stack.length === 0 && startIndex !== null) {
            const bracketContent = str.substring(startIndex, i + 1);
            if (bracketContent.includes('dfrac')) substrings.push(bracketContent);
            startIndex = null;
          }
        }
      }
      for (let substring of substrings) {
        let transformed = substring.replace(/\(/g, "\\left(").replace(/\)/g, "\\right)");
        transformed = transformed.replace(/\|/g, "\\left|").replace(/\|/g, "\\right|");
        str = str.replace(substring, transformed);
      }

      return str;
    }
    function replace(str) {
      const regex = new RegExp(Object.keys(replacementMap).join('|'), 'g');
      return str.replace(regex, match => replacementMap[match]);
    }
    latexString = replace(latexString);
    latexString = latexString.replace(/(_|\^)\{[^}]*dfrac[^}]*\}/g, function (match) {
      return match.replace(/dfrac/g, 'frac');
    })
    latexString = processBrackets(latexString);
    return latexString
  }
  const result = parseLatex(node);
  const postProcessedResult = postProcess(result)
  return `\\(${postProcessedResult}\\)`
}