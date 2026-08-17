# Timetable App

## Admin Setup Process

To set up an admin user, the first user who deploys and logs into the system must add their Google email to the `authorizedAdmins` list via the Firestore database directly or via the first initialization script. After this, they can use the Admin Settings screen in the UI to dynamically add or remove other administrators. Any user added to this list will have full admin rights, including Data Maintenance.
