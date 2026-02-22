import './Footer.css';

const TEAM = [
  {
    name: 'Abdalrahman',
    github: 'https://github.com/Abdelrhman941',
    avatar: 'https://github.com/Abdelrhman941.png',
  },
  {
    name: 'Hassan',
    github: 'https://github.com/HassanZoghly',
    avatar: 'https://github.com/HassanZoghly.png',
  },
  {
    name: 'Abdallah',
    github: 'https://github.com/AbdallahElesh22',
    avatar: 'https://github.com/AbdallahElesh22.png',
  },
  {
    name: 'Moustafa',
    github: 'https://github.com/moustafa-nasser',
    avatar: 'https://github.com/moustafa-nasser.png',
  },
  {
    name: 'Mohamed',
    github: 'https://github.com/mohamedali572',
    avatar: 'https://github.com/mohamedali572.png',
  },
];


function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        {/* Left */}
        <div className="site-footer__left">
          <p className="site-footer__built">Built by the VirtAI team</p>
          <p className="site-footer__tag">AI Avatar · Real-time · Voice · RAG</p>
        </div>

        {/* Right — avatar group */}
        <div className="site-footer__avatars" aria-label="Team members">
          {TEAM.map((member) => (
            <a
              key={member.name}
              href={member.github}
              target="_blank"
              rel="noopener noreferrer"
              className="site-footer__avatar-link"
              aria-label={`${member.name} on GitHub`}
              title={member.name}
            >
              <img
                src={member.avatar}
                alt={member.name}
                className="site-footer__avatar"
                width={36}
                height={36}
                loading="lazy"
              />
              <span className="site-footer__tooltip" aria-hidden="true">{member.name}</span>
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default Footer;