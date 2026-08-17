const fs = require('fs');
let file = fs.readFileSync('components/TeacherLoadReportScreen.tsx', 'utf8');

file = file.replace(/<th className="([^"]+)">/g, (match, classes) => {
    // If it's in the TeacherLoadReportScreen, let's add print:whitespace-nowrap and print:w-auto
    return `<th className="${classes} print:whitespace-nowrap print:w-auto">`;
});
fs.writeFileSync('components/TeacherLoadReportScreen.tsx', file);
