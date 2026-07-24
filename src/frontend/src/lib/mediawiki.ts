const headingMap: Record<number, string> = {
  2: '##',
  3: '###',
  4: '####',
  5: '#####',
  6: '######',
};

function convertHeadings(input: string): string {
  return input.replace(/^(=+)([^=]+?)=+$/gm, (_match, markers: string, title: string) => {
    const depth = Math.min(Math.max(markers.length, 2), 6);
    const hash = headingMap[depth] ?? '##';
    return `${hash} ${title.trim()}`;
  });
}

function convertLinks(input: string): string {
  let output = input.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, (_match, url: string, label: string) => {
    return `[${label.trim()}](${url})`;
  });
  output = output.replace(/\[(https?:\/\/[^\s\]]+)\]/g, (_match, url: string) => {
    return `[${url}](${url})`;
  });
  output = output.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _target: string, label: string) => {
    return label.trim();
  });
  output = output.replace(/\[\[([^\]]+)\]\]/g, (_match, label: string) => {
    return label.trim();
  });
  return output;
}

function convertLists(input: string): string {
  return input.replace(/^(\s*)([*#]+)\s+/gm, (_match, indent: string, markers: string) => {
    const marker = markers[0] === '#' ? '1.' : '-';
    return `${indent}${marker} `;
  });
}

function convertEmphasis(input: string): string {
  let output = input.replace(/'''''([^']+?)'''''/g, (_match, text: string) => `***${text}***`);
  output = output.replace(/'''([^']+?)'''/g, (_match, text: string) => `**${text}**`);
  output = output.replace(/''([^']+?)''/g, (_match, text: string) => `*${text}*`);
  return output;
}

function convertCode(input: string): string {
  let output = input.replace(/<pre>\s*([\s\S]*?)\s*<\/pre>/gi, (_match, code: string) => {
    return `\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`;
  });
  output = output.replace(/<code>\s*([\s\S]*?)\s*<\/code>/gi, (_match, code: string) => {
    return `\`${code.trim()}\``;
  });
  return output;
}

function stripTemplates(input: string): string {
  return input.replace(/\{\{[^}]+\}\}/g, '').replace(/\{\|[\s\S]*?\|\}/g, '');
}

function tidyWhitespace(input: string): string {
  return input.replace(/\n{3,}/g, '\n\n').trim();
}

export function mediawikiToMarkdown(content: string): string {
  if (!content) return '';
  const normalized = content.replace(/\r\n?/g, '\n');
  const withoutTemplates = stripTemplates(normalized);
  const convertedCode = convertCode(withoutTemplates);
  const convertedHeadings = convertHeadings(convertedCode);
  const convertedLists = convertLists(convertedHeadings);
  const convertedLinks = convertLinks(convertedLists);
  const convertedEmphasis = convertEmphasis(convertedLinks);
  return tidyWhitespace(convertedEmphasis);
}
