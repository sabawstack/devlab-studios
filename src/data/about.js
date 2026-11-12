// src/data/about.js
// Resume-sourced "About Me" content for Stephen Rey G. Agustinez
import { COMPANY } from '../config/company.js'

const aboutData = {
  name: "Stephen Rey G. Agustinez",
  role: "Founder, Full-Stack Developer & AI Automation Architect",
  location: COMPANY.locationLabel,
  email: "hello@devlabstudios.com",
  resumeLink: "/resume.pdf",
  about:
    "Full-stack developer and AI automation specialist building end-to-end systems across React and Astro interfaces, Java and Laravel services, REST APIs, SQL-backed data flows, n8n workflows, and AI agents. I connect every layer from customer experience to operational handoff so systems remain useful, reliable, and maintainable.",
  education: [
    {
      program: "Bachelor of Science in Computer Engineering",
      school:
        "University of Science and Technology of Southern Philippines, Lapasan, Cagayan de Oro City",
      years: "2019 - 2023",
    },
    {
      program: "STEM Strand",
      school:
        "Liceo de Cagayan University - Senior High School, R.N.P. Blvd., Kauswagan, Cagayan de Oro City",
      years: "2017 - 2019",
    },
  ],
  achievementsAndResponsibilities: [
    {
      title: "System Integrator / Programmer, Design 2 - Thesis",
      details:
        "Design and Development of Air Pollution Monitoring System in University of Science and Technology of Southern Philippines (2023).",
    },
    {
      title: "Front-end Developer, Capstone Project",
      details:
        "Fishing Ban Report App for Lanao del Norte (2021-2022).",
    },
  ],
  certificatesAndLicenses: [
    { name: "CCNA: Enterprise Networking, Security, and Automation", issuer: "Cisco", date: "June 2022" },
    { name: "Google Technical Support Fundamentals", issuer: "Google", date: "February 2023" },
    { name: "Introduction to Cybersecurity Tools & Cyber Attacks", issuer: null, date: "September 2020" },
    { name: "Using Google Forms to Analyze User Research Data", issuer: null, date: "2020" },
    { name: "OWASP Top 10: Securing Web Applications", issuer: "OWASP", date: "2025" },
    { name: "CCSP 2019: Identity & Access Management", issuer: null, date: "June 2025" },
    { name: "CCSP 2019: Application Development & Security", issuer: null, date: "June 2025" },
  ],
};

export default aboutData;
