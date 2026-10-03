const fs = require('fs');
const files = ['e:/odooXld/client/member/cafeteria.html', 'e:/odooXld/client/staff/cafeteria.html'];

files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/\\`/g, '`');
    content = content.replace(/\\\${/g, '${');
    fs.writeFileSync(f, content);
    console.log('Fixed:', f);
});
