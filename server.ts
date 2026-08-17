import express from 'express';
import path from 'path';
import { google } from 'googleapis';

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // --- Google Workspace API Endpoints ---

  app.post('/api/workspace/calendar/sync-teachers', async (req, res) => {
    try {
      const userEmailRaw = req.headers['x-user-email'];
      const userEmail = (Array.isArray(userEmailRaw) ? userEmailRaw[0] : userEmailRaw || '').toLowerCase();
      const userRoleRaw = req.headers['x-user-role'];
      const userRole = Array.isArray(userRoleRaw) ? userRoleRaw[0] : userRoleRaw;
      
      try {
         
      } catch (e) {}
      
      
      const isAuthAdmin = userRole === "admin";
      
      if (!isAuthAdmin) {
        return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
      }
      
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }
      const token = authHeader.split(' ')[1];
      
      const { events, semesterEndDate } = req.body;
      
      function formatRecurrenceEndDate(dateStr) {
        if (!dateStr) return '20261016T235959Z';
        const cleanDate = dateStr.replace(/-/g, '');
        if (cleanDate.length !== 8) return '20261016T235959Z';
        return `${cleanDate}T235959Z`;
      }
      
      const formattedEndDate = formatRecurrenceEndDate(semesterEndDate);
      
      let eventCount = 0;
      if (events && Array.isArray(events)) {
        // Group events by targetTeacherEmail
        const eventsByTeacher = {};
        for (const ev of events) {
           const email = ev.targetTeacherEmail;
           if (!email) continue;
           if (!eventsByTeacher[email]) eventsByTeacher[email] = [];
           eventsByTeacher[email].push(ev);
        }

        for (const [teacherEmail, teacherEvents] of Object.entries(eventsByTeacher)) {
          let authClient;
          try {
            const auth = new google.auth.GoogleAuth({
              scopes: ['https://www.googleapis.com/auth/calendar']
            });
            authClient = await auth.getClient();
            if (typeof authClient.setSubject === 'function') {
                authClient.setSubject(teacherEmail);
            } else {
                authClient.subject = teacherEmail;
            }
          } catch (e) {
            console.error("Failed to initialize Google Auth for DwD:", e);
            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: token });
            authClient = oauth2Client;
          }
          const calendar = google.calendar({ version: 'v3', auth: authClient });
          
          for (const ev of (teacherEvents as any[])) {
            const requestBody: any = {
               summary: ev.summary,
               description: ev.description,
               start: { dateTime: ev.start, timeZone: 'Asia/Bangkok' },
               end: { dateTime: ev.end, timeZone: 'Asia/Bangkok' },
               location: ev.location,
            };
            if (formattedEndDate) {
                requestBody.recurrence = [`RRULE:FREQ=WEEKLY;UNTIL=${formattedEndDate}`];
            }
            try {
              await calendar.events.insert({
                calendarId: 'primary',
                requestBody
              });
              eventCount++;
            } catch (insErr) {
               console.error("Calendar Sync Event Error:", insErr);
            }
          }
        }
      }
      res.json({ success: true, message: `Teacher calendars synced successfully. Inserted ${eventCount} events.` });
    } catch (error) {
      console.error('Error syncing calendars:', error);
      res.status(500).json({ error: (error.message || "Internal Server Error") });
    }
  });

  app.post('/api/workspace/calendar/sync-students', async (req, res) => {
    try {
      const userEmailRaw = req.headers['x-user-email'];
      const userEmail = (Array.isArray(userEmailRaw) ? userEmailRaw[0] : userEmailRaw || '').toLowerCase();
      const userRoleRaw = req.headers['x-user-role'];
      const userRole = Array.isArray(userRoleRaw) ? userRoleRaw[0] : userRoleRaw;
      
      try {
         
      } catch (e) {}
      
      
      const isAuthAdmin = userRole === "admin";
      
      if (!isAuthAdmin) {
        return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
      }
      
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }
      const token = authHeader.split(' ')[1];
      
      const { groupEmail, events, semesterEndDate } = req.body;
      
      function formatRecurrenceEndDate(dateStr) {
        if (!dateStr) return '20261016T235959Z';
        const cleanDate = dateStr.replace(/-/g, '');
        if (cleanDate.length !== 8) return '20261016T235959Z';
        return `${cleanDate}T235959Z`;
      }
      const formattedEndDate = formatRecurrenceEndDate(semesterEndDate);
      
      let eventCount = 0;
      if (events && Array.isArray(events)) {
        // Group events by teacher email to minimize auth client creations
        const eventsByTeacher = {};
        for (const ev of events) {
           let teacherEmail = ev.targetTeacherEmail;
           if (!teacherEmail) continue;
           if (!eventsByTeacher[teacherEmail]) eventsByTeacher[teacherEmail] = [];
           eventsByTeacher[teacherEmail].push(ev);
        }

        for (const [teacherEmail, teacherEvents] of Object.entries(eventsByTeacher)) {
          let authClient;
          try {
            const auth = new google.auth.GoogleAuth({
              scopes: ['https://www.googleapis.com/auth/calendar']
            });
            authClient = await auth.getClient();
            if (typeof authClient.setSubject === 'function') {
                authClient.setSubject(teacherEmail);
            } else {
                authClient.subject = teacherEmail;
            }
          } catch (e) {
            console.error("Failed to initialize Google Auth for DwD:", e);
            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: token });
            authClient = oauth2Client;
          }
          const calendar = google.calendar({ version: 'v3', auth: authClient });
          
          for (const ev of (teacherEvents as any[])) {
              const requestBody: any = {
                  summary: ev.summary,
                  description: ev.description,
                  start: { dateTime: ev.start, timeZone: 'Asia/Bangkok' },
                  end: { dateTime: ev.end, timeZone: 'Asia/Bangkok' },
                  location: ev.location,
                  attendees: []
              };
              if (groupEmail) {
                 requestBody.attendees.push({ email: groupEmail });
              }
              if (formattedEndDate) {
                  requestBody.recurrence = [`RRULE:FREQ=WEEKLY;UNTIL=${formattedEndDate}`];
              }
              try {
                await calendar.events.insert({
                  calendarId: 'primary',
                  requestBody,
                  sendUpdates: 'all' // notify attendees (students)
                });
                eventCount++;
              } catch (insErr) {
                 console.error("Calendar Sync Event Error:", insErr);
              }
          }
        }
      }
      res.json({ success: true, message: `Student calendars synced successfully. Created ${eventCount} events.` });
    } catch (error) {
      console.error('Error syncing student calendars:', error);
      res.status(500).json({ error: (error.message || "Internal Server Error") });
    }
  });

app.post('/api/workspace/directory/batch-insert', async (req, res) => {
    try {
      const userEmailRaw = req.headers['x-user-email'];
      const userEmail = (Array.isArray(userEmailRaw) ? userEmailRaw[0] : userEmailRaw || '').toLowerCase();
      const userRoleRaw = req.headers['x-user-role'];
      const userRole = Array.isArray(userRoleRaw) ? userRoleRaw[0] : userRoleRaw;
      
      try {
         
      } catch (e) {}
      
      
      const isAuthAdmin = userRole === "admin";
      
      if (!isAuthAdmin) {
        return res.status(403).json({ error: 'Unauthorized: Admin access required.' });
      }
      
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }
      const token = authHeader.split(' ')[1];
      if (token === 'null' || !token) {
        return res.status(401).json({ error: 'Session expired or missing Google Access Token. Please log out and log in again.' });
      }
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: token });

      const admin = google.admin({ version: 'directory_v1', auth: oauth2Client });
      const { groupEmail, memberEmails, classroomName } = req.body;

      console.log(`Syncing ${memberEmails?.length} members to Google Group: ${groupEmail}`);
      
      if (!groupEmail || !memberEmails || !Array.isArray(memberEmails)) {
        return res.status(400).json({ error: 'Invalid groupEmail or memberEmails array' });
      }

      // Step 1: Check and create group if missing
      let groupExists = false;
      try {
        await admin.groups.get({ groupKey: groupEmail });
        groupExists = true;
      } catch (err: any) {
        if (err.code !== 404 && err.status !== 404 && !err.message?.includes('Not Found')) {
          throw err;
        }
      }

      if (!groupExists) {
        console.log(`Group ${groupEmail} not found. Creating new group...`);
        await admin.groups.insert({
          requestBody: {
            email: groupEmail,
            name: classroomName ? `นักเรียนห้อง ${classroomName}` : `Group ${groupEmail.split('@')[0]}`,
            description: "Automated Student Email Group"
          }
        });
      }

      // Step 2: Fetch current members
      let currentMembers: any[] = [];
      let pageToken: string | undefined = undefined;
      do {
        const response = await admin.members.list({
          groupKey: groupEmail,
          pageToken: pageToken
        });
        if (response.data.members) {
          currentMembers = currentMembers.concat(response.data.members);
        }
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      const currentEmails = currentMembers.map(m => m.email?.toLowerCase());
      const newEmails = memberEmails.map(e => e.trim().toLowerCase());

      const toAdd = newEmails.filter(e => !currentEmails.includes(e));
      const toRemove = currentMembers.filter(m => m.email && !newEmails.includes(m.email.toLowerCase()));

      let addedCount = 0;
      let removedCount = 0;
      let errorCount = 0;

      // Add missing students
      for (const email of toAdd) {
        try {
          await admin.members.insert({
            groupKey: groupEmail,
            requestBody: {
              email: email,
              role: 'MEMBER'
            }
          });
          addedCount++;
        } catch (err: any) {
          console.error(`Error adding ${email}:`, err.message);
          errorCount++;
        }
      }

      // Remove obsolete students
      for (const member of toRemove) {
        if (!member.id && !member.email) continue;
        try {
          await admin.members.delete({
            groupKey: groupEmail,
            memberKey: member.id || member.email
          });
          removedCount++;
        } catch (err: any) {
          console.error(`Error removing ${member.email}:`, err.message);
          errorCount++;
        }
      }

      res.json({ success: true, message: `Members synced to ${groupEmail} successfully. Added: ${addedCount}, Removed: ${removedCount}, Errors: ${errorCount}` });
    } catch (error: any) {
      console.error('Error syncing members:', error);
      if (error.code === 403 || error.status === 403) {
         return res.status(403).json({ error: "The authenticated account lacks delegated administrative access to manage the specific user's calendar or Google Group." });
      }
      let errMsg = error.message || "Internal Server Error";
      if (errMsg.includes('Admin SDK API has not been used')) {
          errMsg = 'คุณยังไม่ได้เปิดใช้งาน Google Admin SDK API ใน Google Cloud Project กรุณาไปที่ https://console.developers.google.com/apis/api/admin.googleapis.com/overview เพื่อเปิดใช้งาน จากนั้นรอสักครู่แล้วลองอีกครั้ง';
      } else if (errMsg.includes('Invalid authentication credentials') || errMsg.includes('invalid authentication credentials')) {
          errMsg = 'เซสชันหมดอายุ หรือสิทธิ์การใช้งานไม่เพียงพอ กรุณาออกจากระบบแล้วลงชื่อเข้าใช้งานใหม่อีกครั้ง';
      }
      res.status(500).json({ error: errMsg });
    }
  });

  // 3. Centralized Schedule Email Dispatch
  app.post('/api/workspace/gmail/send-timetable', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }
      const token = authHeader.split(' ')[1];
      if (token === 'null' || !token) {
        return res.status(401).json({ error: 'Session expired or missing Google Access Token. Please log out and log in again.' });
      }
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: token });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const { groupEmail, subject, htmlContent } = req.body;

      console.log(`Sending timetable email via Gmail API to ${groupEmail}...`);
      
      if (!groupEmail || !htmlContent) {
        return res.status(400).json({ error: 'Missing groupEmail or htmlContent' });
      }

      const emailLines = [
        `To: ${groupEmail}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: =?utf-8?B?${Buffer.from(subject || 'Timetable Update').toString('base64')}?=`,
        '',
        htmlContent
      ];
      
      const emailRaw = emailLines.join('\r\n');
      const base64EncodedEmail = Buffer.from(emailRaw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: base64EncodedEmail,
        }
      });

      res.json({ success: true, message: `Timetable email dispatched successfully to ${groupEmail}.` });
    } catch (error: any) {
      console.error('Error sending emails:', error);
      res.status(500).json({ error: (error.message || "Internal Server Error") });
    }
  });

  // Vite middleware สำหรับโหมดทดสอบพัฒนา
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();